//! HTTP + WebSocket client for the bizi server. Mirrors `@getbizi/client`.

use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

// Request and response shapes come from the crate the server defines its API
// with, so this client cannot disagree with the server about the wire format.
pub use bizi_api::TaskRunLogsStreamMessage;
use bizi_api::{
    CancelTaskRequest, GetTaskRunLogsResponse, GetTaskRunResponse, ListTaskRunsResponse,
    ListTasksResponse, RestartTaskRequest, StartTaskRequest, StartTaskResponse, TaskMap,
    TaskRunLogLine, TaskRunTreeNode,
};

pub const BIZI_API_PORT: u16 = 7436;
pub const BIZI_API_HOST: &str = "localhost";

#[derive(Clone)]
pub struct BiziApi {
    client: reqwest::Client,
    host: String,
    port: u16,
}

/// Unwraps one of the API's untagged `Success | Error` responses, surfacing the
/// server's own message when it is the error arm.
macro_rules! unwrap_response {
    ($response:expr, $enum:ident) => {
        match $response {
            $enum::Success(body) => body,
            $enum::Error(error) => bail!("{}", error.message),
        }
    };
}

impl BiziApi {
    pub fn new() -> Self {
        Self::with_target(BIZI_API_HOST.to_string(), BIZI_API_PORT)
    }

    pub fn with_target(host: String, port: u16) -> Self {
        Self {
            client: reqwest::Client::new(),
            host,
            port,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}:{}{}", self.host, self.port, path)
    }

    fn ws_url(&self, path: &str) -> String {
        format!("ws://{}:{}{}", self.host, self.port, path)
    }

    pub async fn list_tasks(&self, cwd: &str) -> Result<TaskMap> {
        let response = self
            .client
            .get(self.url("/api/tasks"))
            .query(&[("cwd", cwd)])
            .send()
            .await
            .context("failed to reach the bizi server")?;
        let body = unwrap_response!(
            read_json::<ListTasksResponse>(response).await?,
            ListTasksResponse
        );
        Ok(body.tasks)
    }

    pub async fn list_task_runs(&self, cwd: &str) -> Result<Vec<TaskRunTreeNode>> {
        let response = self
            .client
            .get(self.url("/api/tasks/runs"))
            .query(&[("cwd", cwd)])
            .send()
            .await
            .context("failed to reach the bizi server")?;
        let body = unwrap_response!(
            read_json::<ListTaskRunsResponse>(response).await?,
            ListTaskRunsResponse
        );
        Ok(body.task_runs)
    }

    pub async fn get_task_run(&self, run_id: &str) -> Result<TaskRunTreeNode> {
        let response = self
            .client
            .get(self.url(&format!("/api/tasks/{}", encode_path(run_id))))
            .send()
            .await
            .context("failed to reach the bizi server")?;
        let body = unwrap_response!(
            read_json::<GetTaskRunResponse>(response).await?,
            GetTaskRunResponse
        );
        Ok(body.task_run)
    }

    pub async fn get_task_run_logs(
        &self,
        run_id: &str,
        include_children: bool,
    ) -> Result<Vec<TaskRunLogLine>> {
        let response = self
            .client
            .get(self.url(&format!("/api/tasks/{}/logs", encode_path(run_id))))
            .query(&[("includeChildren", include_children.to_string())])
            .send()
            .await
            .context("failed to reach the bizi server")?;
        let body = unwrap_response!(
            read_json::<GetTaskRunLogsResponse>(response).await?,
            GetTaskRunLogsResponse
        );
        Ok(body.logs)
    }

    pub async fn run_task(
        &self,
        task: &str,
        cwd: &str,
        include_tasks: Option<Vec<String>>,
    ) -> Result<String> {
        let response = self
            .client
            .post(self.url("/api/tasks/run"))
            .json(&StartTaskRequest {
                task: task.to_string(),
                cwd: cwd.to_string(),
                include_tasks,
            })
            .send()
            .await
            .context("failed to reach the bizi server")?;
        let body = unwrap_response!(
            read_json::<StartTaskResponse>(response).await?,
            StartTaskResponse
        );
        Ok(body.run_id)
    }

    pub async fn cancel_task(&self, run_id: &str) -> Result<()> {
        let response = self
            .client
            .post(self.url("/api/tasks/cancel"))
            .json(&CancelTaskRequest {
                run_id: run_id.to_string(),
            })
            .send()
            .await
            .context("failed to reach the bizi server")?;
        ensure_ok(response).await
    }

    pub async fn restart_task(&self, run_id: &str) -> Result<()> {
        let response = self
            .client
            .post(self.url("/api/tasks/restart"))
            .json(&RestartTaskRequest {
                run_id: run_id.to_string(),
            })
            .send()
            .await
            .context("failed to reach the bizi server")?;
        ensure_ok(response).await
    }

    /// Streams task run updates until the socket closes or the receiver goes
    /// away. Callers own the lifetime by spawning (and aborting) this future.
    pub async fn stream_task_run<T, F>(&self, run_id: &str, sender: mpsc::Sender<T>, wrap: F)
    where
        T: Send + 'static,
        F: Fn(TaskRunTreeNode) -> T + Send + 'static,
    {
        let url = self.ws_url(&format!("/api/tasks/{}", encode_path(run_id)));
        stream_json(url, sender, move |text| {
            match serde_json::from_str::<GetTaskRunResponse>(&text) {
                Ok(GetTaskRunResponse::Success(body)) => Some(wrap(body.task_run)),
                _ => None,
            }
        })
        .await;
    }

    /// Streams log snapshots and appended lines for a run.
    pub async fn stream_task_logs<T, F>(
        &self,
        run_id: &str,
        include_children: bool,
        sender: mpsc::Sender<T>,
        wrap: F,
    ) where
        T: Send + 'static,
        F: Fn(TaskRunLogsStreamMessage) -> T + Send + 'static,
    {
        let query = if include_children {
            "?includeChildren=true"
        } else {
            ""
        };
        let url = self.ws_url(&format!("/api/tasks/{}/logs{query}", encode_path(run_id)));
        stream_json(url, sender, move |text| {
            serde_json::from_str::<TaskRunLogsStreamMessage>(&text)
                .ok()
                .map(&wrap)
        })
        .await;
    }
}

impl Default for BiziApi {
    fn default() -> Self {
        Self::new()
    }
}

async fn stream_json<T, F>(url: String, sender: mpsc::Sender<T>, decode: F)
where
    T: Send + 'static,
    F: Fn(String) -> Option<T> + Send + 'static,
{
    let Ok((mut socket, _)) = tokio_tungstenite::connect_async(&url).await else {
        return;
    };

    while let Some(message) = socket.next().await {
        match message {
            Ok(Message::Text(text)) => {
                if let Some(decoded) = decode(text)
                    && sender.send(decoded).await.is_err()
                {
                    break;
                }
            }
            Ok(Message::Ping(payload)) => {
                if socket.send(Message::Pong(payload)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => {}
        }
    }

    let _ = socket.close(None).await;
}

async fn read_json<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let text = response
        .text()
        .await
        .context("failed to read the server response")?;
    if !status.is_success() {
        bail!("{}", server_error_message(&text, status.as_u16()));
    }
    serde_json::from_str(&text).context("failed to decode the server response")
}

async fn ensure_ok(response: reqwest::Response) -> Result<()> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let text = response.text().await.unwrap_or_default();
    bail!("{}", server_error_message(&text, status.as_u16()));
}

fn server_error_message(body: &str, status: u16) -> String {
    serde_json::from_str::<bizi_api::ErrorResponse>(body)
        .map(|error| error.message)
        .unwrap_or_else(|_| format!("request failed with status {status}"))
}

/// Percent encodes the characters that can legally appear in a run id but would
/// otherwise change the request path.
fn encode_path(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_path_segments() {
        assert_eq!(encode_path("abc_123-x"), "abc_123-x");
        assert_eq!(encode_path("a/b c"), "a%2Fb%20c");
    }

    #[test]
    fn decodes_log_stream_messages() {
        let snapshot: TaskRunLogsStreamMessage =
            serde_json::from_str(r#"{"type":"snapshot","runId":"r1","logs":[]}"#).unwrap();
        assert!(matches!(
            snapshot,
            TaskRunLogsStreamMessage::Snapshot { .. }
        ));

        // Servers older than the camelCase fix send `run_id`; dropping those
        // snapshots left the log pane stuck on the previously selected task.
        let legacy_snapshot: TaskRunLogsStreamMessage =
            serde_json::from_str(r#"{"type":"snapshot","run_id":"r1","logs":[]}"#).unwrap();
        match legacy_snapshot {
            TaskRunLogsStreamMessage::Snapshot { run_id, logs } => {
                assert_eq!(run_id, "r1");
                assert!(logs.is_empty());
            }
            _ => panic!("expected a snapshot"),
        }

        let error: TaskRunLogsStreamMessage =
            serde_json::from_str(r#"{"type":"error","message":"nope"}"#).unwrap();
        match error {
            TaskRunLogsStreamMessage::Error { message } => assert_eq!(message, "nope"),
            _ => panic!("expected an error message"),
        }
    }
}
