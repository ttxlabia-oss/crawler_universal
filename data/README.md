# Catalog Data Artifact

`catalog.db.tar.gz` contains the SQLite catalog database from this session.

The raw `catalog.db` file is larger than GitHub's 2GB single-object LFS limit, so it is stored compressed. Restore it with:

```bash
tar -xzf data/catalog.db.tar.gz -C data
```
