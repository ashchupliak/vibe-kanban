use std::{fs, path::Path, sync::Arc};

use async_trait::async_trait;
use derivative::Derivative;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

use crate::{
    approvals::ExecutorApprovalService,
    command::CmdOverrides,
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseAgentCapability, CodingAgent, ExecutorError,
        SpawnedChild, StandardCodingAgentExecutor, claude::ClaudeCode, codex::Codex,
        gemini::Gemini, opencode::Opencode,
    },
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, TS, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(use_ts_enum)]
pub enum JbaiClient {
    Claude,
    Codex,
    Gemini,
    Opencode,
}

impl JbaiClient {
    fn base_command(self) -> &'static str {
        match self {
            Self::Claude => "jbai-claude",
            Self::Codex => "jbai-codex",
            Self::Gemini => "jbai-gemini",
            Self::Opencode => "jbai-opencode",
        }
    }
}

fn default_jbai_client() -> JbaiClient {
    JbaiClient::Claude
}

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct Jbai {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default = "default_jbai_client")]
    #[schemars(title = "JB AI Client", description = "Select which jbai CLI to run")]
    pub client: JbaiClient,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(title = "Model", description = "Model override for the selected client")]
    pub model: Option<String>,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

impl Jbai {
    fn cmd_with_client(&self) -> CmdOverrides {
        let mut cmd = self.cmd.clone();
        if cmd.base_command_override.is_none() {
            cmd.base_command_override = Some(self.client.base_command().to_string());
        }
        cmd
    }

    fn resolve_token(&self, env: &ExecutionEnv) -> Option<String> {
        let from_profile = self
            .cmd
            .env
            .as_ref()
            .and_then(|vars| vars.get("JBAI_TOKEN"))
            .cloned();
        if from_profile.is_some() {
            return from_profile;
        }
        env.vars.get("JBAI_TOKEN").cloned()
    }

    fn ensure_token_file(&self, env: &ExecutionEnv) -> Result<(), ExecutorError> {
        let token = match self.resolve_token(env) {
            Some(value) => value.trim().to_string(),
            None => return Ok(()),
        };
        if token.is_empty() {
            return Ok(());
        }

        let home = dirs::home_dir().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Unable to resolve home directory"))
        })?;
        let jbai_dir = home.join(".jbai");
        let token_path = jbai_dir.join("token");

        if let Ok(existing) = fs::read_to_string(&token_path) {
            if existing.trim() == token {
                return Ok(());
            }
        }

        fs::create_dir_all(&jbai_dir).map_err(ExecutorError::Io)?;
        fs::write(&token_path, format!("{token}\n")).map_err(ExecutorError::Io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            let _ = fs::set_permissions(&token_path, perms);
        }
        Ok(())
    }

    pub fn capabilities(&self) -> Vec<BaseAgentCapability> {
        match self.client {
            JbaiClient::Claude | JbaiClient::Gemini | JbaiClient::Opencode => {
                vec![BaseAgentCapability::SessionFork]
            }
            JbaiClient::Codex => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::SetupHelper,
            ],
        }
    }

    pub fn get_mcp_config(&self) -> crate::mcp_config::McpConfig {
        use crate::mcp_config::McpConfig;
        let preconfigured = match self.client {
            JbaiClient::Claude => CodingAgent::ClaudeCode(self.build_claude()).preconfigured_mcp(),
            JbaiClient::Codex => CodingAgent::Codex(self.build_codex()).preconfigured_mcp(),
            JbaiClient::Gemini => CodingAgent::Gemini(self.build_gemini()).preconfigured_mcp(),
            JbaiClient::Opencode => {
                CodingAgent::Opencode(self.build_opencode()).preconfigured_mcp()
            }
        };
        match self.client {
            JbaiClient::Codex => McpConfig::new(
                vec!["mcp_servers".to_string()],
                serde_json::json!({
                    "mcp_servers": {}
                }),
                preconfigured,
                true,
            ),
            JbaiClient::Opencode => McpConfig::new(
                vec!["mcp".to_string()],
                serde_json::json!({
                    "mcp": {},
                    "$schema": "https://opencode.ai/config.json"
                }),
                preconfigured,
                false,
            ),
            JbaiClient::Gemini | JbaiClient::Claude => McpConfig::new(
                vec!["mcpServers".to_string()],
                serde_json::json!({
                    "mcpServers": {}
                }),
                preconfigured,
                false,
            ),
        }
    }

    fn build_claude(&self) -> ClaudeCode {
        ClaudeCode::new_with_overrides(
            self.append_prompt.clone(),
            self.model.clone(),
            self.cmd_with_client(),
        )
    }

    fn build_codex(&self) -> Codex {
        Codex::new_with_overrides(
            self.append_prompt.clone(),
            self.model.clone(),
            self.cmd_with_client(),
        )
    }

    pub fn codex_config(&self) -> Option<Codex> {
        if matches!(self.client, JbaiClient::Codex) {
            Some(self.build_codex())
        } else {
            None
        }
    }

    fn build_gemini(&self) -> Gemini {
        Gemini {
            append_prompt: self.append_prompt.clone(),
            model: self.model.clone(),
            yolo: None,
            cmd: self.cmd_with_client(),
            approvals: None,
        }
    }

    fn build_opencode(&self) -> Opencode {
        Opencode {
            append_prompt: self.append_prompt.clone(),
            model: self.model.clone(),
            mode: None,
            auto_approve: true,
            cmd: self.cmd_with_client(),
            approvals: None,
        }
    }

    fn with_approvals<T: StandardCodingAgentExecutor>(&self, mut executor: T) -> T {
        if let Some(approvals) = self.approvals.clone() {
            executor.use_approvals(approvals);
        }
        executor
    }
}

#[async_trait]
impl StandardCodingAgentExecutor for Jbai {
    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.ensure_token_file(env)?;
        match self.client {
            JbaiClient::Claude => {
                let executor = self.with_approvals(self.build_claude());
                executor.spawn(current_dir, prompt, env).await
            }
            JbaiClient::Codex => {
                let executor = self.with_approvals(self.build_codex());
                executor.spawn(current_dir, prompt, env).await
            }
            JbaiClient::Gemini => {
                let executor = self.with_approvals(self.build_gemini());
                executor.spawn(current_dir, prompt, env).await
            }
            JbaiClient::Opencode => {
                let executor = self.with_approvals(self.build_opencode());
                executor.spawn(current_dir, prompt, env).await
            }
        }
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.ensure_token_file(env)?;
        match self.client {
            JbaiClient::Claude => {
                let executor = self.with_approvals(self.build_claude());
                executor
                    .spawn_follow_up(current_dir, prompt, session_id, env)
                    .await
            }
            JbaiClient::Codex => {
                let executor = self.with_approvals(self.build_codex());
                executor
                    .spawn_follow_up(current_dir, prompt, session_id, env)
                    .await
            }
            JbaiClient::Gemini => {
                let executor = self.with_approvals(self.build_gemini());
                executor
                    .spawn_follow_up(current_dir, prompt, session_id, env)
                    .await
            }
            JbaiClient::Opencode => {
                let executor = self.with_approvals(self.build_opencode());
                executor
                    .spawn_follow_up(current_dir, prompt, session_id, env)
                    .await
            }
        }
    }

    fn normalize_logs(&self, msg_store: Arc<MsgStore>, worktree_path: &Path) {
        match self.client {
            JbaiClient::Claude => self.build_claude().normalize_logs(msg_store, worktree_path),
            JbaiClient::Codex => self.build_codex().normalize_logs(msg_store, worktree_path),
            JbaiClient::Gemini => self.build_gemini().normalize_logs(msg_store, worktree_path),
            JbaiClient::Opencode => self.build_opencode().normalize_logs(msg_store, worktree_path),
        }
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        match self.client {
            JbaiClient::Claude => dirs::home_dir().map(|home| home.join(".claude.json")),
            JbaiClient::Codex => crate::executors::codex::codex_home()
                .map(|home| home.join("config.toml")),
            JbaiClient::Gemini => {
                dirs::home_dir().map(|home| home.join(".gemini").join("settings.json"))
            }
            JbaiClient::Opencode => {
                #[cfg(unix)]
                {
                    xdg::BaseDirectories::with_prefix("opencode").get_config_file("opencode.json")
                }
                #[cfg(not(unix))]
                {
                    dirs::config_dir().map(|config| config.join("opencode").join("opencode.json"))
                }
            }
        }
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let token_file = dirs::home_dir().map(|home| home.join(".jbai").join("token"));
        if let Some(path) = token_file
            && let Some(timestamp) = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
        {
            return AvailabilityInfo::LoginDetected {
                last_auth_timestamp: timestamp,
            };
        }

        let config_dir_found = dirs::home_dir()
            .map(|home| home.join(".jbai").exists())
            .unwrap_or(false);

        if config_dir_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }
}
