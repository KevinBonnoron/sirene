package apierr

// Mirrors shared/src/types/error.type.ts (the client's i18n keys); codes_test.go keeps them in sync.
const (
	CodeInternal   = "internal"
	CodeNotFound   = "notFound"
	CodeValidation = "validation"
	CodeTooLarge   = "request.tooLarge"

	CodeAuthInvalidCredentials = "auth.invalidCredentials"
	CodeAuthInvalidToken       = "auth.invalidToken"
	CodeAuthRegistrationFailed = "auth.registrationFailed"
	CodeAuthRequired           = "auth.required"
	CodeAuthForbidden          = "auth.forbidden"
	CodeAuthMissingScope       = "auth.missingScope"
	CodeAuthEmailTaken         = "auth.emailTaken"

	CodeApiKeyNotFound     = "apiKey.notFound"
	CodeApiKeyUnknownScope = "apiKey.unknownScope"

	CodeCliAuthSessionAlreadyUsed = "cliAuth.sessionAlreadyUsed"
	CodeCliAuthSessionNotFound    = "cliAuth.sessionNotFound"

	CodeGenerationNotFound                      = "generation.notFound"
	CodeInferenceServerNotFound                 = "inferenceServer.notFound"
	CodeInferenceServerInvalidRegistrationToken = "inferenceServer.invalidRegistrationToken"
	CodeInferenceServerInvalidURL               = "inferenceServer.invalidUrl"
	CodeInferenceServerNameTaken                = "inferenceServer.nameTaken"

	CodeModelAlreadyInstalled       = "model.alreadyInstalled"
	CodeModelConfigInvalidJson      = "model.configInvalidJson"
	CodeModelConfigNotPiper         = "model.configNotPiper"
	CodeModelCustomNotFound         = "model.customNotFound"
	CodeModelDeleteFailed           = "model.deleteFailed"
	CodeModelExportFailed           = "model.exportFailed"
	CodeModelInvalidName            = "model.invalidName"
	CodeModelInvalidServerSelection = "model.invalidServerSelection"
	CodeModelNameConflict           = "model.nameConflict"
	CodeModelNoOnlineServer         = "model.noOnlineServer"
	CodeModelNotFound               = "model.notFound"
	CodeModelNotInCatalog           = "model.notInCatalog"
	CodeModelNotInstalled           = "model.notInstalled"
	CodeModelNotInstalledOnServer   = "model.notInstalledOnServer"
	CodeModelPiperFieldsRequired    = "model.piperFieldsRequired"
	CodeModelServerIdsInvalid       = "model.serverIdsInvalid"
	CodeModelServerIdsNotJson       = "model.serverIdsNotJson"
	CodeModelWhisperNotInstalled    = "model.whisperNotInstalled"

	CodeSessionNotFound    = "session.notFound"
	CodeSettingsInvalidKey = "settings.invalidKey"

	CodeElevenLabsKeyNotConfigured = "elevenlabs.keyNotConfigured"
	CodeOpenAIKeyNotConfigured     = "openai.keyNotConfigured"

	CodeTranscribeAudioRequired = "transcribe.audioRequired"
	CodeTranscribeTimeout       = "transcribe.timeout"

	CodeUpstreamElevenLabs = "upstream.elevenlabs"
	CodeUpstreamInference  = "upstream.inference"
	CodeUpstreamOpenAI     = "upstream.openai"

	CodeUserNotFound = "user.notFound"

	CodeVoiceArchiveInvalidJson       = "voice.archiveInvalidJson"
	CodeVoiceArchiveMissing           = "voice.archiveMissing"
	CodeVoiceArchiveMissingName       = "voice.archiveMissingName"
	CodeVoiceAudioRequired            = "voice.audioRequired"
	CodeVoiceCloningRequiresSample    = "voice.cloningRequiresSample"
	CodeVoiceElevenLabsPresetRequired = "voice.elevenLabsPresetRequired"
	CodeVoiceNoModel                  = "voice.noModel"
	CodeVoiceNotFound                 = "voice.notFound"
	CodeVoiceOpenAIPresetRequired     = "voice.openAiPresetRequired"
	CodeVoiceZipRequired              = "voice.zipRequired"

	CodeVoiceDesignerNameAudioRequired  = "voiceDesigner.nameAudioRequired"
	CodeVoiceDesignerTextFieldsExpected = "voiceDesigner.textFieldsExpected"
)

var AllCodes = []string{
	CodeInternal, CodeNotFound, CodeValidation, CodeTooLarge,
	CodeAuthInvalidCredentials, CodeAuthInvalidToken, CodeAuthRegistrationFailed, CodeAuthRequired, CodeAuthForbidden, CodeAuthMissingScope, CodeAuthEmailTaken,
	CodeApiKeyNotFound, CodeApiKeyUnknownScope,
	CodeCliAuthSessionAlreadyUsed, CodeCliAuthSessionNotFound,
	CodeGenerationNotFound, CodeInferenceServerNotFound, CodeInferenceServerInvalidRegistrationToken, CodeInferenceServerInvalidURL, CodeInferenceServerNameTaken,
	CodeModelAlreadyInstalled, CodeModelConfigInvalidJson, CodeModelConfigNotPiper, CodeModelCustomNotFound, CodeModelDeleteFailed, CodeModelExportFailed,
	CodeModelInvalidName, CodeModelInvalidServerSelection, CodeModelNameConflict, CodeModelNoOnlineServer, CodeModelNotFound, CodeModelNotInCatalog,
	CodeModelNotInstalled, CodeModelNotInstalledOnServer, CodeModelPiperFieldsRequired, CodeModelServerIdsInvalid, CodeModelServerIdsNotJson, CodeModelWhisperNotInstalled,
	CodeSessionNotFound, CodeSettingsInvalidKey,
	CodeElevenLabsKeyNotConfigured, CodeOpenAIKeyNotConfigured,
	CodeTranscribeAudioRequired, CodeTranscribeTimeout,
	CodeUpstreamElevenLabs, CodeUpstreamInference, CodeUpstreamOpenAI,
	CodeUserNotFound,
	CodeVoiceArchiveInvalidJson, CodeVoiceArchiveMissing, CodeVoiceArchiveMissingName, CodeVoiceAudioRequired, CodeVoiceCloningRequiresSample,
	CodeVoiceElevenLabsPresetRequired, CodeVoiceNoModel, CodeVoiceNotFound, CodeVoiceOpenAIPresetRequired, CodeVoiceZipRequired,
	CodeVoiceDesignerNameAudioRequired, CodeVoiceDesignerTextFieldsExpected,
}
