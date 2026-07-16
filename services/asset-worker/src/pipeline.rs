//! The WorkQueue lifecycle decision — the pure core the reliability spine rests on. Kept free of NATS
//! and HTTP so it is exhaustively unit-testable; worker.rs is the thin glue that pulls messages, runs
//! `handle_job`, and settles the JetStream message per the returned `Ack`.

use crate::callback::{Reporter, ResultBody};
use crate::job::AssetJob;
use crate::processor::{Outcome, ProcessError, Processor};

/// How to settle the JetStream message after handling one job. The variants deliberately mirror the
/// NATS `AckKind` vocabulary (Ack/Nak/Term), so the redundant-reading `Ack::Ack` is intentional.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ack {
    /// Done (success, or a permanent failure that was reported) — remove from the WorkQueue.
    Ack,
    /// Transient — redeliver later (until the consumer's max-deliver).
    Nak,
    /// Terminal: transient budget exhausted (poison messages are Termed in worker.rs before decide) —
    /// stop redelivering so a permanently-flaky job can't loop forever (conventions §Queue DLQ).
    Term,
}

/// The lifecycle decision for a processed job: the callback to send (if any) and how to settle the msg.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub body: Option<ResultBody>,
    pub ack: Ack,
}

/// decide maps a process result to a callback + settle action. `delivered`/`max_deliver` gate the
/// terminal-transient case: a transient failure on the LAST allowed delivery is reported `failed` and
/// Termed, so a permanently-flaky job is surfaced (Admin "AssetJob failed") instead of silently looping
/// or vanishing. A mid-budget transient sends NO callback (don't flip the job to `failed` prematurely).
pub fn decide(result: Result<Outcome, ProcessError>, delivered: u64, max_deliver: u64) -> Decision {
    match result {
        Ok(outcome) => Decision {
            body: Some(ResultBody {
                status: "ready",
                // exactly one of these is Some, per job kind (ADR-049); core-api writes whichever it is.
                model3d_url: outcome.model3d_url,
                sprite_sheet_url: outcome.sprite_sheet_url,
                object_names: outcome.object_names, // f-2: model_ingest's object list (empty for sprite/STL)
                last_error: None,
            }),
            ack: Ack::Ack,
        },
        Err(ProcessError::Permanent(msg)) => Decision {
            body: Some(ResultBody {
                status: "failed",
                model3d_url: None,
                sprite_sheet_url: None,
                object_names: Vec::new(),
                last_error: Some(msg),
            }),
            ack: Ack::Ack,
        },
        Err(ProcessError::Transient(msg)) => {
            if delivered >= max_deliver {
                Decision {
                    body: Some(ResultBody {
                        status: "failed",
                        model3d_url: None,
                        sprite_sheet_url: None,
                        object_names: Vec::new(),
                        last_error: Some(format!("giving up after {delivered} attempts: {msg}")),
                    }),
                    ack: Ack::Term,
                }
            } else {
                Decision {
                    body: None,
                    ack: Ack::Nak,
                }
            }
        }
    }
}

/// handle_job processes one parsed job and reports the result — the testable unit (fake processor +
/// fake reporter, no NATS/HTTP). Returns how to settle the message. A report failure demotes an
/// Ack/Term to Nak (redeliver) so a result never silently vanishes because the callback was briefly
/// unreachable; the callback is idempotent (core-api `ready` is sticky), so re-reporting is safe.
pub async fn handle_job<P: Processor, R: Reporter>(
    job: &AssetJob,
    processor: &P,
    reporter: &R,
    delivered: u64,
    max_deliver: u64,
) -> Ack {
    let result = processor.process(job).await;
    let decision = decide(result, delivered, max_deliver);
    if let Some(body) = &decision.body {
        if let Err(e) = reporter.report(&job.asset_job_id, body).await {
            tracing::warn!(job = %job.asset_job_id, error = %e, "callback report failed — will redeliver");
            return Ack::Nak;
        }
    }
    decision.ack
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::JobType;
    use std::sync::Mutex;

    fn job() -> AssetJob {
        AssetJob {
            asset_job_id: "job-1".into(),
            product_id: "prod-1".into(),
            job_type: JobType::ModelIngest,
            source_model_url: "https://s3/lumin-assets/src.glb".into(),
            source_version: "v1".into(),
        }
    }

    // --- decide: the pure lifecycle table ---
    #[test]
    fn ready_acks_and_reports_url() {
        let d = decide(
            Ok(Outcome {
                model3d_url: Some("u.glb".into()),
                ..Default::default()
            }),
            1,
            5,
        );
        assert_eq!(d.ack, Ack::Ack);
        assert_eq!(d.body.unwrap().status, "ready");
    }

    // A sprite_render Outcome flows spriteSheetUrl (not model3dUrl) into the ready callback (ADR-049).
    #[test]
    fn ready_sprite_reports_sprite_url() {
        let d = decide(
            Ok(Outcome {
                sprite_sheet_url: Some("s.webp".into()),
                ..Default::default()
            }),
            1,
            5,
        );
        let body = d.body.unwrap();
        assert_eq!(body.status, "ready");
        assert_eq!(body.sprite_sheet_url.as_deref(), Some("s.webp"));
        assert!(
            body.model3d_url.is_none(),
            "sprite ready must not carry a model url"
        );
    }

    #[test]
    fn permanent_reports_failed_and_acks() {
        let d = decide(Err(ProcessError::Permanent("bad".into())), 1, 5);
        assert_eq!(d.ack, Ack::Ack);
        let b = d.body.unwrap();
        assert_eq!(b.status, "failed");
        assert_eq!(b.last_error.unwrap(), "bad");
    }

    #[test]
    fn transient_mid_budget_naks_without_reporting() {
        let d = decide(Err(ProcessError::Transient("blip".into())), 2, 5);
        assert_eq!(d.ack, Ack::Nak);
        assert!(
            d.body.is_none(),
            "must not flip the job to failed mid-retry"
        );
    }

    #[test]
    fn transient_at_budget_terms_and_reports_failed() {
        let d = decide(Err(ProcessError::Transient("blip".into())), 5, 5);
        assert_eq!(
            d.ack,
            Ack::Term,
            "exhausted budget must not redeliver forever"
        );
        assert_eq!(d.body.unwrap().status, "failed");
    }

    // --- handle_job: process → report → ack, with fakes ---
    struct FakeProcessor(Result<Outcome, ProcessError>);
    impl Processor for FakeProcessor {
        async fn process(&self, _job: &AssetJob) -> Result<Outcome, ProcessError> {
            self.0.clone()
        }
    }

    // Mutex (not RefCell) so the fake is Sync — the Reporter::report future is `+ Send`, matching the
    // real HttpReporter which runs on the multi-thread runtime.
    #[derive(Default)]
    struct FakeReporter {
        calls: Mutex<Vec<ResultBody>>,
        fail: bool,
    }
    impl Reporter for FakeReporter {
        async fn report(&self, _job_id: &str, body: &ResultBody) -> anyhow::Result<()> {
            self.calls.lock().unwrap().push(body.clone());
            if self.fail {
                anyhow::bail!("callback down");
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn handle_ready_reports_once_and_acks() {
        let p = FakeProcessor(Ok(Outcome {
            model3d_url: Some("out.glb".into()),
            ..Default::default()
        }));
        let r = FakeReporter::default();
        let ack = handle_job(&job(), &p, &r, 1, 5).await;
        assert_eq!(ack, Ack::Ack);
        assert_eq!(r.calls.lock().unwrap().len(), 1);
        assert_eq!(r.calls.lock().unwrap()[0].status, "ready");
    }

    #[tokio::test]
    async fn handle_transient_mid_budget_naks_and_never_reports() {
        let p = FakeProcessor(Err(ProcessError::Transient("blip".into())));
        let r = FakeReporter::default();
        let ack = handle_job(&job(), &p, &r, 1, 5).await;
        assert_eq!(ack, Ack::Nak);
        assert!(r.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn handle_report_failure_demotes_to_nak() {
        // A ready job whose callback is unreachable must redeliver (Nak), not ack-and-lose the result.
        let p = FakeProcessor(Ok(Outcome {
            model3d_url: Some("out.glb".into()),
            ..Default::default()
        }));
        let r = FakeReporter {
            fail: true,
            ..Default::default()
        };
        let ack = handle_job(&job(), &p, &r, 1, 5).await;
        assert_eq!(ack, Ack::Nak);
        assert_eq!(
            r.calls.lock().unwrap().len(),
            1,
            "it did attempt the report"
        );
    }
}
