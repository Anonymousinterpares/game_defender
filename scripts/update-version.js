const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACKAGE_JSON_PATH = path.join(__dirname, '../package.json');
const VERSION_TS_PATH = path.join(__dirname, '../src/version.ts');
const STATE_FILE_PATH = path.join(__dirname, '../.last_build_state');
const WATCH_DIRS = ['src', 'public'];

function getDirectoryHash(dir) {
    const hash = crypto.createHash('sha256');
    const files = getAllFiles(dir);

    files.forEach(file => {
        // Skip hidden files
        if (path.basename(file).startsWith('.')) return;

        const content = fs.readFileSync(file);
        hash.update(file);
        hash.update(content);
    });

    return hash.digest('hex');
}

function getAllFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllFiles(filePath));
        } else {
            results.push(filePath);
        }
    });
    return results.sort();
}

function updateVersion() {
    console.log('--- Checking for changes to increment version ---');

    let currentHash = '';
    WATCH_DIRS.forEach(dir => {
        const dirPath = path.join(__dirname, '..', dir);
        if (fs.existsSync(dirPath)) {
            currentHash += getDirectoryHash(dirPath);
        }
    });

    const combinedHash = crypto.createHash('sha256').update(currentHash).digest('hex');

    let lastHash = '';
    if (fs.existsSync(STATE_FILE_PATH)) {
        lastHash = fs.readFileSync(STATE_FILE_PATH, 'utf8').trim();
    }

    if (combinedHash === lastHash) {
        console.log('No changes detected since last build. Skipping version increment.');
        return;
    }

    // Increment version
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const oldVersion = parseFloat(pkg.version);
    const newVersion = (oldVersion + 0.01).toFixed(2);

    pkg.version = newVersion;
    fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n');
    fs.writeFileSync(VERSION_TS_PATH, `export const VERSION = '${newVersion}';\n`);
    fs.writeFileSync(STATE_FILE_PATH, combinedHash);

    console.log(`Changes detected. Version incremented: ${oldVersion} -> ${newVersion}`);
}

updateVersion();
