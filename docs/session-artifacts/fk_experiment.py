import sys, tempfile, pathlib, psycopg
import pixeltable_pgserver as p
d = pathlib.Path(tempfile.mkdtemp()); s = p.get_server(d, cleanup_mode="delete")
with psycopg.connect(s.get_uri(), autocommit=True) as c:
    print("server_version:", c.execute("show server_version").fetchone()[0])
    for mode in ("restrict", "no action"):
        c.execute("drop table if exists child; drop table if exists parent")
        c.execute("create table parent(id int primary key)")
        c.execute(f"create table child(pid int references parent(id) on delete {mode})")
        c.execute("insert into parent values (1); insert into child values (1)")
        try:
            c.execute("delete from parent where id=1")
        except psycopg.Error as e:
            print(f"  on delete {mode:9s} -> {type(e).__name__} sqlstate={e.sqlstate}")
