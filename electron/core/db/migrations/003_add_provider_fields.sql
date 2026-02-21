-- Migration: Add separate translate_provider and tts_provider fields
-- This allows using different providers for translation and TTS

-- Add new provider fields to tasks table
ALTER TABLE tasks ADD COLUMN translate_provider TEXT DEFAULT 'minimax';
ALTER TABLE tasks ADD COLUMN tts_provider TEXT DEFAULT 'minimax';

-- Update existing tasks to set the new fields based on the legacy provider field
UPDATE tasks SET translate_provider = provider WHERE translate_provider IS NULL;
UPDATE tasks SET tts_provider = provider WHERE tts_provider IS NULL;
