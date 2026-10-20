import os
import psycopg2
from psycopg2 import errors
from dotenv import load_dotenv

# Read database connection information from .env
load_dotenv()

DB_NAME = os.getenv("POSTGRES_DB", "school_database")
DB_USER = os.getenv("POSTGRES_USER", "vscode")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "vscode")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_SSLMODE = os.getenv("DB_SSLMODE", "prefer")


def main():
    print(f"Connecting to {DB_NAME} at {DB_HOST}:{DB_PORT} as {DB_USER} ...")

    conn = psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        sslmode=DB_SSLMODE,
    )

    cur = conn.cursor()

    # --------------------------------------------------
    # READ
    # Show the top 10 students based on GPA
    # --------------------------------------------------

    print("\nTop 10 students by GPA:")

    cur.execute("""
        SELECT student_id, first_name, last_name, grade_level, gpa
        FROM students
        ORDER BY gpa DESC, last_name ASC
        LIMIT 10;
    """)

    for row in cur.fetchall():
        print(row)

    try:
        # --------------------------------------------------
        # CREATE
        # Insert a new student
        # --------------------------------------------------

        print("\nInserting a new student...")

        cur.execute("""
            INSERT INTO students
                (student_id, first_name, last_name, grade_level, gpa)
            VALUES
                (%s, %s, %s, %s, %s)
            RETURNING student_id, first_name, last_name, grade_level, gpa;
        """, (
            "student_101",
            "Emily",
            "Carter",
            "Grade 11",
            3.75
        ))

        print("Inserted:", cur.fetchone())

        # --------------------------------------------------
        # UPDATE
        # Update the GPA of an existing student
        # --------------------------------------------------

        print("\nUpdating GPA for student_001...")

        cur.execute("""
            UPDATE students
            SET gpa = 3.85
            WHERE student_id = %s
            RETURNING student_id, first_name, last_name, gpa;
        """, ("student_001",))

        print("Updated:", cur.fetchone())

        # --------------------------------------------------
        # DELETE
        # Delete the student with the lowest GPA
        # --------------------------------------------------

        print("\nDeleting student with the lowest GPA...")

        cur.execute("""
            DELETE FROM students
            WHERE student_id = (
                SELECT student_id
                FROM students
                ORDER BY gpa ASC, student_id ASC
                LIMIT 1
            )
            RETURNING student_id, first_name, last_name, gpa;
        """)

        print("Deleted:", cur.fetchone())

        # Save CREATE, UPDATE, and DELETE
        conn.commit()

        print("\nChanges committed.")

    except errors.InsufficientPrivilege as e:
        # This happens if the database connection is read-only
        conn.rollback()

        print("\nWrite blocked by the database:",
              str(e).strip().splitlines()[0])

        print(
            "This connection is read-only, so "
            "INSERT/UPDATE/DELETE are refused and nothing was changed."
        )

    cur.close()
    conn.close()

    print("\nDone.")


if __name__ == "__main__":
    main()