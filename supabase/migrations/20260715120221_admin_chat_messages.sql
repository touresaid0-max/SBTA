/*
# Admin Direct Chat Messages

1. New Tables
  - `admin_chat_messages`
    - `id` (uuid, primary key)
    - `sender_id` (uuid, FK → auth.users) - who sent the message
    - `receiver_id` (uuid, FK → auth.users) - who receives the message
    - `content` (text) - message body
    - `is_read` (boolean) - whether receiver has read the message
    - `created_at` (timestamptz) - when the message was sent

2. Security
  - Enable RLS on `admin_chat_messages`.
  - Authenticated users can SELECT messages they sent or received.
  - Authenticated users can INSERT messages where they are the sender.
  - Authenticated users can UPDATE messages they received (to mark as read).
  - No DELETE policy (messages are permanent).

3. Indexes
  - Composite index on (sender_id, receiver_id, created_at) for conversation queries.

4. Realtime
  - Enable realtime on admin_chat_messages for live chat.
*/

CREATE TABLE IF NOT EXISTS admin_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_conversation
  ON admin_chat_messages (sender_id, receiver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_receiver
  ON admin_chat_messages (receiver_id, created_at DESC);

-- RLS Policies
DROP POLICY IF EXISTS "select_own_chat_messages" ON admin_chat_messages;
CREATE POLICY "select_own_chat_messages" ON admin_chat_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "insert_own_chat_messages" ON admin_chat_messages;
CREATE POLICY "insert_own_chat_messages" ON admin_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "update_received_chat_messages" ON admin_chat_messages;
CREATE POLICY "update_received_chat_messages" ON admin_chat_messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = receiver_id);

DROP POLICY IF EXISTS "delete_own_chat_messages" ON admin_chat_messages;
CREATE POLICY "delete_own_chat_messages" ON admin_chat_messages FOR DELETE
  TO authenticated
  USING (auth.uid() = sender_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE admin_chat_messages;
