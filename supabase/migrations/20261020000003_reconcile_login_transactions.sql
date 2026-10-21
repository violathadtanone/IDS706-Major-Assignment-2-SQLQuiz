-- Reconcile the existing hosted table without replacing it or deleting history.
DO $$
DECLARE
    old_name text;
    new_name text;
    policy_name text;
    role_name text;
    column_list text;
BEGIN
    IF to_regclass('public.login_transactions') IS NULL THEN
        RAISE EXCEPTION 'login_transactions is missing; apply its initial migration first';
    END IF;

    FOR old_name, new_name IN
        SELECT * FROM (VALUES
            ('login_at', 'logged_in_at'),
            ('auth_method', 'authentication_method')
        ) AS names(old_column, new_column)
    LOOP
        IF EXISTS (SELECT 1 FROM pg_attribute
            WHERE attrelid = 'public.login_transactions'::regclass
              AND attname = old_name AND NOT attisdropped) THEN
            IF EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = 'public.login_transactions'::regclass
                  AND attname = new_name AND NOT attisdropped) THEN
                RAISE EXCEPTION 'Both % and % exist; reconcile these columns before retrying', old_name, new_name;
            END IF;
            EXECUTE format('ALTER TABLE public.login_transactions RENAME COLUMN %I TO %I', old_name, new_name);
        END IF;
    END LOOP;

    IF (SELECT count(*) FROM pg_attribute
        WHERE attrelid = 'public.login_transactions'::regclass AND NOT attisdropped
          AND attname IN ('user_id', 'logged_in_at', 'authentication_method', 'session_id')) <> 4 THEN
        RAISE EXCEPTION 'login_transactions is missing a required application column';
    END IF;

    ALTER TABLE public.login_transactions
        ALTER COLUMN logged_in_at SET DEFAULT now(),
        ALTER COLUMN authentication_method SET DEFAULT 'email_otp';

    -- Keep the hosted text session IDs and its existing unique constraint, or
    -- the UUID primary key created by the original migration on a fresh setup.
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = 'public.login_transactions'::regclass
          AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1
          AND i.indpred IS NULL AND i.indexprs IS NULL AND a.attname = 'session_id'
    ) THEN
        CREATE UNIQUE INDEX login_transactions_session_dedup
            ON public.login_transactions (session_id);
    END IF;

    -- Enforce complete new records without discarding any legacy records.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.login_transactions'::regclass
          AND conname = 'login_transactions_required_fields') THEN
        ALTER TABLE public.login_transactions
            ADD CONSTRAINT login_transactions_required_fields CHECK (
                user_id IS NOT NULL AND logged_in_at IS NOT NULL
                AND authentication_method IS NOT NULL
                AND authentication_method = 'email_otp'
                AND session_id IS NOT NULL AND length(session_id::text) > 0
            ) NOT VALID;
    END IF;

    ALTER TABLE public.login_transactions ENABLE ROW LEVEL SECURITY;
    -- This table needs no client policies: the trusted service role bypasses RLS.
    FOR policy_name IN SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'login_transactions'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.login_transactions', policy_name);
    END LOOP;

    REVOKE ALL ON TABLE public.login_transactions FROM PUBLIC;
    SELECT string_agg(format('%I', attname), ', ') INTO column_list
        FROM pg_attribute WHERE attrelid = 'public.login_transactions'::regclass
          AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.login_transactions FROM PUBLIC', column_list);
    FOR role_name IN SELECT rolname FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'quiz_taker', 'quiz_runner', 'service_role')
    LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.login_transactions FROM %I', role_name);
        EXECUTE format('REVOKE ALL (%s) ON TABLE public.login_transactions FROM %I', column_list, role_name);
    END LOOP;
    GRANT SELECT, INSERT ON TABLE public.login_transactions TO service_role;
END
$$;
