const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'scraper.db');
const db = new sqlite3.Database(dbPath);

// 🗄️ Database Initialization
db.serialize(() => {
    // 📑 Recipes Table (Added detail_selectors)
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        url TEXT,
        selectors TEXT,
        detail_selectors TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 📋 Results Table
    db.run(`CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recipe_id) REFERENCES recipes(id)
    )`);
});

module.exports = {
    saveRecipe: (recipe) => {
        return new Promise((resolve, reject) => {
            const { name, url, selectors, detailSelectors } = recipe;
            db.run(
                `INSERT INTO recipes (name, url, selectors, detail_selectors) VALUES (?, ?, ?, ?)`,
                [name, url, JSON.stringify(selectors), JSON.stringify(detailSelectors || {})],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, ...recipe });
                }
            );
        });
    },
    getRecipes: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM recipes ORDER BY created_at DESC`, [], (err, rows) => {
                if (err) reject(err);
                else {
                    resolve(rows.map(r => ({ 
                        ...r, 
                        selectors: JSON.parse(r.selectors || '{}'),
                        detailSelectors: JSON.parse(r.detail_selectors || '{}')
                    })));
                }
            });
        });
    }
};
