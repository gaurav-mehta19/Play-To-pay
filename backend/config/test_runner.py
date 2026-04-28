import time

import psycopg2
from django.db import connections
from django.db.backends.postgresql.creation import DatabaseCreation
from django.test.runner import DiscoverRunner


class RetryingDatabaseCreation(DatabaseCreation):
    """
    Before every DROP DATABASE attempt, connects directly to the 'postgres'
    database as a superuser and terminates ALL sessions for the test DB (no
    pid exclusion), then waits until pg_stat_activity confirms they are gone
    before issuing the DROP.
    """

    def _destroy_test_db(self, test_database_name, verbosity):
        cfg = self.connection.settings_dict

        def _kill_sessions():
            try:
                admin = psycopg2.connect(
                    host=cfg['HOST'],
                    port=int(cfg.get('PORT') or 5432),
                    user=cfg['USER'],
                    password=cfg['PASSWORD'],
                    dbname='postgres',
                )
                admin.autocommit = True
                with admin.cursor() as cur:
                    cur.execute(
                        "SELECT pg_terminate_backend(pid) "
                        "FROM pg_stat_activity "
                        "WHERE datname = %s",
                        [test_database_name],
                    )
                    # Wait until pg_stat_activity is actually clear.
                    for _ in range(20):
                        cur.execute(
                            "SELECT count(*) FROM pg_stat_activity WHERE datname = %s",
                            [test_database_name],
                        )
                        if cur.fetchone()[0] == 0:
                            break
                        time.sleep(0.1)
                admin.close()
            except Exception:
                pass

        for attempt in range(5):
            _kill_sessions()
            try:
                super()._destroy_test_db(test_database_name, verbosity)
                return
            except Exception as exc:
                if 'being accessed by other users' in str(exc) and attempt < 4:
                    time.sleep(0.5)
                else:
                    raise


class DroppingTestRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        for alias in connections:
            conn = connections[alias]
            conn.__dict__['creation'] = RetryingDatabaseCreation(conn)
        return super().setup_databases(**kwargs)
