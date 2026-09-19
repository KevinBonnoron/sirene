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
	CodeAuthRegistrationClosed = "auth.registrationClosed"

	CodeApiKeyNotFound     = "apiKey.notFound"
	CodeApiKeyUnknownScope = "apiKey.unknownScope"

	CodeCliAuthSessionAlreadyUsed = "cliAuth.sessionAlreadyUsed"
	CodeCliAuthSessionNotFound    = "cliAuth.sessionNotFound"

	CodeGenerationNotFound                      = "generation.notFound"
	CodeInviteAlreadyPending                    = "invite.alreadyPending"
	CodeInviteAlreadyUsed                       = "invite.alreadyUsed"
	CodeInviteEmailMismatch                     = "invite.emailMismatch"
	CodeInviteExpired                           = "invite.expired"
	CodeInviteNotFound                          = "invite.notFound"
	CodeInviteRequired                          = "invite.required"
	CodeInferenceServerNotFound                 = "inferenceServer.notFound"
	CodeInferenceServerInvalidRegistrationToken = "inferenceServer.invalidRegistrationToken"
	CodeInferenceServerInvalidURL               = "inferenceServer.invalidUrl"
	CodeInferenceServerNameTaken                = "inferenceServer.nameTaken"
	CodeInferenceServerStatsUnsupported         = "inferenceServer.statsUnsupported"

	CodeModelAlreadyInstalled       = "model.alreadyInstalled"
	CodeModelConfigInvalidJson      = "model.configInvalidJson"
	CodeModelConfigNotPiper         = "model.configNotPiper"
	CodeModelDeleteFailed           = "model.deleteFailed"
	CodeModelInvalidName            = "model.invalidName"
	CodeModelInvalidServerSelection = "model.invalidServerSelection"
	CodeModelNameConflict           = "model.nameConflict"
	CodeModelNoAcceptingServer      = "model.noAcceptingServer"
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
	CodeAuthInvalidCredentials, CodeAuthInvalidToken, CodeAuthRegistrationFailed, CodeAuthRequired, CodeAuthForbidden, CodeAuthMissingScope, CodeAuthEmailTaken, CodeAuthRegistrationClosed,
	CodeApiKeyNotFound, CodeApiKeyUnknownScope,
	CodeCliAuthSessionAlreadyUsed, CodeCliAuthSessionNotFound,
	CodeGenerationNotFound, CodeInviteAlreadyPending, CodeInviteAlreadyUsed, CodeInviteEmailMismatch, CodeInviteExpired, CodeInviteNotFound, CodeInviteRequired,
	CodeInferenceServerNotFound, CodeInferenceServerInvalidRegistrationToken, CodeInferenceServerInvalidURL, CodeInferenceServerNameTaken, CodeInferenceServerStatsUnsupported,
	CodeModelAlreadyInstalled, CodeModelConfigInvalidJson, CodeModelConfigNotPiper, CodeModelDeleteFailed,
	CodeModelInvalidName, CodeModelInvalidServerSelection, CodeModelNameConflict, CodeModelNoAcceptingServer, CodeModelNoOnlineServer, CodeModelNotFound, CodeModelNotInCatalog,
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
