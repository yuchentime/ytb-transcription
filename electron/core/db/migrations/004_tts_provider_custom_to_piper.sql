-- Migration: Rename legacy custom TTS provider to piper
-- Scope: TTS provider only; translation custom provider is preserved.

UPDATE tasks
SET tts_provider = 'piper'
WHERE tts_provider = 'custom';

UPDATE settings
SET value = '"piper"'
WHERE key = 'ttsProvider' AND value = '"custom"';
