//! The bizi HTTP and websocket wire contract.
//!
//! Every type the server puts on the wire and every type a Rust client reads
//! back off it lives here, defined exactly once. Before this crate existed the
//! server and the Rust TUI each kept their own copy, and the two drifted: the
//! log websocket's snapshot message named a field `run_id` on one side and
//! `runId` on the other, so every snapshot silently failed to decode and task
//! logs never loaded.
//!
//! Note that the OpenAPI document only covers the HTTP surface. The websocket
//! messages at the bottom of this file are part of the contract too, so they
//! live here rather than being written out by hand in each client.
//!
//! # Features
//!
//! - `schema` — adds `utoipa::ToSchema`, for the server that publishes the spec.
//! - `orm` — adds SeaORM derives to [`TaskRunStatus`] so it doubles as a column
//!   type. Both are off by default, so clients compile neither.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

// `DeriveActiveEnum` expands to a `db_type` referring to `StringLen` unqualified.
#[cfg(feature = "orm")]
use sea_orm::prelude::StringLen;

/// Applies `#[derive(utoipa::ToSchema)]` only when the `schema` feature is on.
macro_rules! wire_type {
    ($(#[$meta:meta])* $vis:vis struct $name:ident { $($body:tt)* }) => {
        $(#[$meta])*
        #[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
        $vis struct $name { $($body)* }
    };
    ($(#[$meta:meta])* $vis:vis enum $name:ident { $($body:tt)* }) => {
        $(#[$meta])*
        #[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
        $vis enum $name { $($body)* }
    };
}

// ------------------------------------------------------------------ statuses

// Lifecycle of a single task run. Serialized with the default variant names, so
// the wire format is `"Queued"`, `"Running"`, and so on. With the `orm` feature
// this is also the database column type, where it is stored lowercase instead.
//
// Doc comments on these types become OpenAPI descriptions, so anything that is
// an implementation note rather than part of the published contract stays in an
// ordinary comment like this one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(
    feature = "orm",
    derive(sea_orm::EnumIter, sea_orm::DeriveActiveEnum),
    sea_orm(rs_type = "String", db_type = "String(StringLen::None)")
)]
pub enum TaskRunStatus {
    #[cfg_attr(feature = "orm", sea_orm(string_value = "queued"))]
    Queued,
    #[cfg_attr(feature = "orm", sea_orm(string_value = "running"))]
    Running,
    #[cfg_attr(feature = "orm", sea_orm(string_value = "success"))]
    Success,
    #[cfg_attr(feature = "orm", sea_orm(string_value = "cancelled"))]
    Cancelled,
    #[cfg_attr(feature = "orm", sea_orm(string_value = "failed"))]
    Failed,
}

impl TaskRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskRunStatus::Queued => "Queued",
            TaskRunStatus::Running => "Running",
            TaskRunStatus::Success => "Success",
            TaskRunStatus::Cancelled => "Cancelled",
            TaskRunStatus::Failed => "Failed",
        }
    }

    /// Queued or running: the run may still do more work.
    pub fn is_active(self) -> bool {
        matches!(self, TaskRunStatus::Queued | TaskRunStatus::Running)
    }

    /// Finished, one way or another.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            TaskRunStatus::Success | TaskRunStatus::Failed | TaskRunStatus::Cancelled
        )
    }

    /// Process exit code a CLI should use for this outcome.
    pub fn exit_code(self) -> i32 {
        if matches!(self, TaskRunStatus::Success) {
            0
        } else {
            1
        }
    }
}

// -------------------------------------------------------------------- tasks

wire_type! {
    // A task as declared in `task.config.json`. Absent fields serialize as
    // `null` rather than being skipped, which is what the OpenAPI document and
    // the generated TypeScript client already expect.
    #[derive(Debug, Clone, Default, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Task {
        /// The title of the task.
        pub title: Option<String>,
        /// The color used for client-side log rendering for this task.
        pub color: Option<String>,
        /// The command that the task will run.
        pub command: Option<String>,
        /// Any other task names that this task depends on.
        pub depends_on: Option<Vec<String>>,
        /// Whether the task is optional. If true, the task will only run if started manually.
        pub optional: Option<bool>,
        /// Subtasks of this task. Keys must be unique task names.
        pub tasks: Option<IndexMap<String, Task>>,
        pub depends_on_tasks: Option<IndexMap<String, Task>>,
    }
}

// Tasks keyed by their fully qualified key (`dev`, `dev:api`, …), in the order
// they appear in `task.config.json`. Clients use this; the API boundary spells
// the map out so utoipa does not emit a `$ref` to an unregistered schema.
pub type TaskMap = IndexMap<String, Task>;

wire_type! {
    // A task run and, nested underneath it, the runs it started.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TaskRunTreeNode {
        pub id: String,
        pub task: String,
        pub cwd: String,
        pub parent_run_id: Option<String>,
        pub status: TaskRunStatus,
        pub updated_at: i64,
        pub waiting_on: Option<String>,
        pub children: Vec<TaskRunTreeNode>,
    }
}

wire_type! {
    // One line of output captured from a running task.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TaskRunLogLine {
        pub run_id: String,
        pub task: String,
        pub line: String,
        pub is_stderr: bool,
        pub timestamp: i64,
        pub sequence: u64,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ErrorResponse {
        pub message: String,
    }
}

// ----------------------------------------------------------- HTTP: requests

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ListTasksRequest {
        #[cfg_attr(feature = "schema", schema(example = "/Users/johndoe/documents/github/example-project"))]
        pub cwd: String,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ListTaskRunsRequest {
        #[cfg_attr(feature = "schema", schema(example = "/Users/johndoe/documents/github/example-project"))]
        pub cwd: String,
    }
}

wire_type! {
    #[derive(Debug, Clone, Default, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GetTaskRunLogsRequest {
        pub include_children: Option<bool>,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct StartTaskRequest {
        pub task: String,
        pub cwd: String,
        pub include_tasks: Option<Vec<String>>,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CancelTaskRequest {
        pub run_id: String,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RestartTaskRequest {
        pub run_id: String,
    }
}

// ---------------------------------------------------------- HTTP: responses

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ListTasksResponseBody {
        /// The list of tasks that are defined in the task.config.json file
        pub tasks: IndexMap<String, Task>,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ListTaskRunsResponseBody {
        /// Root task runs for the cwd, each containing nested child runs.
        pub task_runs: Vec<TaskRunTreeNode>,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GetTaskRunResponseBody {
        pub task_run: TaskRunTreeNode,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GetTaskRunLogsResponseBody {
        pub run_id: String,
        pub logs: Vec<TaskRunLogLine>,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct StartTaskResponseBody {
        pub run_id: String,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CancelTaskResponseBody {
        pub cancelled_run_ids: Vec<String>,
    }
}

wire_type! {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RestartTaskResponseBody {
        pub run_id: String,
    }
}

/// Every endpoint answers with either its success body or an [`ErrorResponse`],
/// untagged, so the shape is what distinguishes them.
macro_rules! response_enum {
    ($name:ident, $body:ident) => {
        wire_type! {
            #[derive(Debug, Clone, Serialize, Deserialize)]
            #[serde(untagged)]
            pub enum $name {
                Success($body),
                Error(ErrorResponse),
            }
        }
    };
}

response_enum!(ListTasksResponse, ListTasksResponseBody);
response_enum!(ListTaskRunsResponse, ListTaskRunsResponseBody);
response_enum!(GetTaskRunResponse, GetTaskRunResponseBody);
response_enum!(GetTaskRunLogsResponse, GetTaskRunLogsResponseBody);
response_enum!(StartTaskResponse, StartTaskResponseBody);
response_enum!(CancelTaskResponse, CancelTaskResponseBody);
response_enum!(RestartTaskResponse, RestartTaskResponseBody);

// --------------------------------------------------------------- websockets

/// A message pushed over `GET /api/tasks/{run_id}/logs` when it is upgraded to
/// a websocket.
///
/// Not part of the OpenAPI document — websockets are outside what it describes —
/// which is exactly why this type is shared rather than hand-written per client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TaskRunLogsStreamMessage {
    Snapshot {
        /// Serialized as `run_id`, unlike every other field in the API.
        ///
        /// `rename_all` on a tagged enum renames the variants, not a struct
        /// variant's fields, so this one was never camelCased. Changing it now
        /// would change the wire format for a field no client reads, so it stays
        /// as-is and the alias below accepts the camelCase spelling too.
        #[serde(alias = "runId")]
        run_id: String,
        logs: Vec<TaskRunLogLine>,
    },
    Log {
        log: TaskRunLogLine,
    },
    Error {
        message: String,
    },
}

/// A message pushed over `GET /api/tasks/{run_id}` when it is upgraded to a
/// websocket. Each frame is a fresh snapshot of the run tree.
pub type TaskRunStreamMessage = GetTaskRunResponse;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_use_their_variant_names_on_the_wire() {
        assert_eq!(
            serde_json::to_string(&TaskRunStatus::Running).unwrap(),
            "\"Running\""
        );
        assert_eq!(TaskRunStatus::Running.as_str(), "Running");
    }

    #[test]
    fn log_stream_snapshot_round_trips_and_accepts_both_run_id_spellings() {
        let encoded = serde_json::to_string(&TaskRunLogsStreamMessage::Snapshot {
            run_id: "r1".to_string(),
            logs: Vec::new(),
        })
        .unwrap();
        assert_eq!(encoded, r#"{"type":"snapshot","run_id":"r1","logs":[]}"#);

        for payload in [
            r#"{"type":"snapshot","run_id":"r1","logs":[]}"#,
            r#"{"type":"snapshot","runId":"r1","logs":[]}"#,
        ] {
            match serde_json::from_str::<TaskRunLogsStreamMessage>(payload).unwrap() {
                TaskRunLogsStreamMessage::Snapshot { run_id, .. } => assert_eq!(run_id, "r1"),
                _ => panic!("expected a snapshot for {payload}"),
            }
        }
    }

    #[test]
    fn tree_nodes_round_trip_through_camel_case() {
        let encoded = serde_json::to_string(&TaskRunTreeNode {
            id: "r1".to_string(),
            task: "dev:api".to_string(),
            cwd: "/tmp".to_string(),
            parent_run_id: Some("root".to_string()),
            status: TaskRunStatus::Running,
            updated_at: 7,
            waiting_on: None,
            children: Vec::new(),
        })
        .unwrap();
        assert!(encoded.contains(r#""parentRunId":"root""#));
        assert!(encoded.contains(r#""updatedAt":7"#));

        let decoded: TaskRunTreeNode = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.status, TaskRunStatus::Running);
    }

    #[test]
    fn untagged_responses_decode_the_error_arm() {
        let decoded: ListTasksResponse = serde_json::from_str(r#"{"message":"nope"}"#).unwrap();
        assert!(matches!(decoded, ListTasksResponse::Error(_)));
    }
}
