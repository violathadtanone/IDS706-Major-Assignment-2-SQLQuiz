-- Successful quiz-app sign-ins only; Supabase continues to manage auth itself.
CREATE TABLE public.login_transactions (
    session_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    authentication_method TEXT NOT NULL CHECK (authentication_method = 'email_otp')
);

ALTER TABLE public.login_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.login_transactions
    FROM PUBLIC, anon, authenticated, quiz_taker, quiz_runner, service_role;
-- Only the existing Edge Function's service client can record/read logins.
GRANT SELECT, INSERT ON TABLE public.login_transactions TO service_role;
