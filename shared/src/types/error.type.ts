/** All error codes the server can emit. Shared between server (throw site)
 *  and client (i18n translation): both reference this single union, so adding
 *  a code or renaming one is a compile-time event on both sides. */
export type ErrorCode =
  // 500 fallback
  | 'internal'
  // Auth
  | 'auth.invalidCredentials'
  | 'auth.invalidToken'
  | 'auth.registrationFailed'
  | 'auth.required'
  // API keys
  | 'apiKey.notFound'
  | 'apiKey.unknownScope'
  // Authorization (scope-based)
  | 'auth.missingScope'
  // CLI auth (device-code flow)
  | 'cliAuth.sessionAlreadyUsed'
  | 'cliAuth.sessionNotFound'
  // Generation
  | 'generation.notFound'
  // Inference server
  | 'inferenceServer.notFound'
  // Model
  | 'model.alreadyInstalled'
  | 'model.configInvalidJson'
  | 'model.configNotPiper'
  | 'model.customNotFound'
  | 'model.deleteFailed'
  | 'model.exportFailed'
  | 'model.invalidName'
  | 'model.invalidServerSelection'
  | 'model.nameConflict'
  | 'model.noOnlineServer'
  | 'model.notFound'
  | 'model.notInCatalog'
  | 'model.notInstalled'
  | 'model.notInstalledOnServer'
  | 'model.piperFieldsRequired'
  | 'model.serverIdsInvalid'
  | 'model.serverIdsNotJson'
  | 'model.whisperNotInstalled'
  // Session
  | 'session.notFound'
  // Settings
  | 'settings.invalidKey'
  // Third-party providers
  | 'elevenlabs.keyNotConfigured'
  | 'openai.keyNotConfigured'
  // Transcribe
  | 'transcribe.audioRequired'
  | 'transcribe.timeout'
  // Upstream
  | 'upstream.elevenlabs'
  | 'upstream.inference'
  | 'upstream.openai'
  // User
  | 'user.notFound'
  // Voice
  | 'voice.archiveInvalidJson'
  | 'voice.archiveMissing'
  | 'voice.archiveMissingName'
  | 'voice.audioRequired'
  | 'voice.cloningRequiresSample'
  | 'voice.elevenLabsPresetRequired'
  | 'voice.noModel'
  | 'voice.notFound'
  | 'voice.openAiPresetRequired'
  | 'voice.zipRequired'
  // Voice designer
  | 'voiceDesigner.nameAudioRequired'
  | 'voiceDesigner.textFieldsExpected';
