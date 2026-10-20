DO $$
BEGIN
    CREATE ROLE quiz_taker NOLOGIN NOINHERIT;
EXCEPTION
    WHEN duplicate_object THEN
        ALTER ROLE quiz_taker NOLOGIN NOINHERIT;
END
$$;

DO $$
BEGIN
    CREATE ROLE quiz_runner LOGIN NOINHERIT;
EXCEPTION
    WHEN duplicate_object THEN
        ALTER ROLE quiz_runner LOGIN NOINHERIT;
END
$$;

GRANT quiz_taker TO quiz_runner;
GRANT CONNECT ON DATABASE postgres TO quiz_runner;
GRANT USAGE ON SCHEMA public TO quiz_taker;
REVOKE ALL ON TABLE public.schools, public.students, public.meals
    FROM PUBLIC, anon, authenticated, quiz_taker;
GRANT SELECT ON TABLE public.schools, public.students, public.meals
    TO quiz_taker;

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_taker_read_schools ON public.schools;
CREATE POLICY quiz_taker_read_schools
    ON public.schools FOR SELECT TO quiz_taker USING (true);
DROP POLICY IF EXISTS quiz_taker_read_students ON public.students;
CREATE POLICY quiz_taker_read_students
    ON public.students FOR SELECT TO quiz_taker USING (true);
DROP POLICY IF EXISTS quiz_taker_read_meals ON public.meals;
CREATE POLICY quiz_taker_read_meals
    ON public.meals FOR SELECT TO quiz_taker USING (true);

CREATE TABLE public.quiz_progress (
    user_id UUID NOT NULL,
    question_id TEXT NOT NULL CHECK (
        question_id IN (
            'top-students',
            'average-gpa',
            'student-count',
            'city-cost',
            'school-cost'
        )
    ),
    query_text TEXT NOT NULL CHECK (length(query_text) <= 12000),
    parameters JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(parameters) = 'array'),
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, question_id)
);

ALTER TABLE public.quiz_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiz_progress
    FROM PUBLIC, anon, authenticated, quiz_taker;
GRANT SELECT, INSERT, UPDATE ON TABLE public.quiz_progress TO service_role;

CREATE TABLE public.quiz_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('query_run', 'quiz_saved')),
    question_id TEXT NOT NULL CHECK (
        question_id IN (
            'top-students',
            'average-gpa',
            'student-count',
            'city-cost',
            'school-cost'
        )
    ),
    query_text TEXT NOT NULL CHECK (length(query_text) <= 12000),
    parameter_count INTEGER NOT NULL DEFAULT 0 CHECK (parameter_count BETWEEN 0 AND 20),
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'error')),
    row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.quiz_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiz_audit_log
    FROM PUBLIC, anon, authenticated, quiz_taker, service_role;
GRANT INSERT ON TABLE public.quiz_audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_quiz_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'quiz_audit_log is append-only'
        USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_quiz_audit_mutation() FROM PUBLIC;

CREATE TRIGGER quiz_audit_no_row_mutation
    BEFORE UPDATE OR DELETE ON public.quiz_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.prevent_quiz_audit_mutation();

CREATE TRIGGER quiz_audit_no_truncate
    BEFORE TRUNCATE ON public.quiz_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_quiz_audit_mutation();

CREATE OR REPLACE FUNCTION public.save_quiz_answer(
    p_actor_id UUID,
    p_question_id TEXT,
    p_query_text TEXT,
    p_parameters JSONB
)
RETURNS public.quiz_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    saved public.quiz_progress;
BEGIN
    IF p_question_id NOT IN (
        'top-students',
        'average-gpa',
        'student-count',
        'city-cost',
        'school-cost'
    ) THEN
        RAISE EXCEPTION 'Unknown quiz question';
    END IF;

    IF p_actor_id IS NULL OR p_query_text IS NULL
        OR length(p_query_text) > 12000
        OR p_parameters IS NULL
        OR jsonb_typeof(p_parameters) <> 'array'
        OR jsonb_array_length(p_parameters) > 20 THEN
        RAISE EXCEPTION 'Invalid quiz submission';
    END IF;

    INSERT INTO public.quiz_progress (
        user_id, question_id, query_text, parameters, saved_at
    )
    VALUES (
        p_actor_id, p_question_id, p_query_text, p_parameters, now()
    )
    ON CONFLICT (user_id, question_id) DO UPDATE
        SET query_text = EXCLUDED.query_text,
            parameters = EXCLUDED.parameters,
            saved_at = EXCLUDED.saved_at
    RETURNING * INTO saved;

    INSERT INTO public.quiz_audit_log (
        actor_id, action, question_id, query_text, parameter_count, outcome
    )
    VALUES (
        p_actor_id,
        'quiz_saved',
        p_question_id,
        p_query_text,
        jsonb_array_length(p_parameters),
        'success'
    );

    RETURN saved;
END;
$$;

REVOKE ALL ON FUNCTION public.save_quiz_answer(UUID, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon, authenticated, quiz_taker;
GRANT EXECUTE ON FUNCTION public.save_quiz_answer(UUID, TEXT, TEXT, JSONB)
    TO service_role;

DO $$
BEGIN
    IF has_table_privilege('quiz_taker', 'public.quiz_audit_log', 'INSERT')
        OR has_table_privilege('quiz_taker', 'public.quiz_audit_log', 'UPDATE')
        OR has_table_privilege('quiz_taker', 'public.quiz_audit_log', 'DELETE')
        OR has_table_privilege('quiz_taker', 'public.quiz_audit_log', 'TRUNCATE') THEN
        RAISE EXCEPTION 'quiz_taker must not mutate quiz_audit_log';
    END IF;
    IF NOT has_table_privilege('quiz_taker', 'public.schools', 'SELECT')
        OR NOT has_table_privilege('quiz_taker', 'public.students', 'SELECT')
        OR NOT has_table_privilege('quiz_taker', 'public.meals', 'SELECT') THEN
        RAISE EXCEPTION 'quiz_taker must be able to read the quiz dataset';
    END IF;
END
$$;
