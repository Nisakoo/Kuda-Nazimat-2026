/** Fixed operator diagnostics only. Never log arbitrary worker messages or stderr. */
const failureCodes = [
  'unavailable', 'unsupported_platform', 'startup_timeout', 'resource_limit', 'memory_unavailable',
  'model_unavailable', 'runner_mismatch', 'tokenizer_unavailable', 'protocol_error', 'input_too_long',
  'output_limit', 'aborted', 'timeout', 'stopped',
  'ollama_options', 'ollama_tokenizer_integrity', 'ollama_model_integrity', 'ollama_dependencies',
  'ollama_tokenizer_load', 'ollama_template', 'ollama_port', 'ollama_runtime_directory', 'ollama_spawn',
  'ollama_listener', 'ollama_version', 'ollama_model_digest', 'ollama_warmup', 'ollama_calibration',
  'ollama_memory_insufficient', 'ollama_token_count_mismatch', 'ollama_runner_rejected',
  'ollama_runner_connection', 'ollama_response_invalid',
] as const;
export type NpcFailureCode = typeof failureCodes[number];
const codes = new Set<string>(failureCodes);
export function isNpcFailureCode(value: unknown): value is NpcFailureCode {
  return typeof value === 'string' && codes.has(value);
}
