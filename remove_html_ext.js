const fs = require('fs');
const path = require('path');

const dir = 'd:\\New folder (2)';
const ignoreDirs = ['node_modules', '.git', '.vscode', '.wwebjs_auth', '.wwebjs_cache', 'brain'];

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Replace in href="page.html" or href='page.html'
    content = content.replace(/href=(["'])([^"']+)\.html(\?[^"']*)?\1/g, 'href=$1$2$3$1');

    // Replace in fetch("page.html")
    content = content.replace(/fetch\((["'])([^"']+)\.html(\?[^"']*)?\1\)/g, 'fetch($1$2$3$1)');

    // Replace in action="page.html"
    content = content.replace(/action=(["'])([^"']+)\.html(\?[^"']*)?\1/g, 'action=$1$2$3$1');

    // Replace in <meta http-equiv="refresh" content="3;url=index.html">
    content = content.replace(/url=([^"']+)\.html/g, 'url=$1');

    // Replace in values like <option value="admin dashboard.html">
    content = content.replace(/value=(["'])([^"']+)\.html(\?[^"']*)?\1/g, 'value=$1$2$3$1');

    // Also a generic replacement for any literal string ending in .html that looks like a relative page link, e.g. 'login.html'
    const pageNames = ['home', 'vote', 'results', 'complaints', 'login', 'register', 'admin dashboard', 'voter dashboard', 'Approval', 'Candidatedash', 'know', 'download-voter-id', 'choice', 'candidate-login'];
    pageNames.forEach(page => {
        const regex = new RegExp(`(["'\`])${page}\\.html(["'\`])`, 'g');
        content = content.replace(regex, `$1${page}$2`);
        const regexQuery = new RegExp(`(["'\`])${page}\\.html\\?([^"'\`]*)(["'\`])`, 'g');
        content = content.replace(regexQuery, `$1${page}?$2$3`);
    });

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Updated ' + filePath);
    }
}

function walk(currentDir) {
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
        if (ignoreDirs.includes(file)) continue;
        const fullPath = path.join(currentDir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walk(fullPath);
        } else if (fullPath.endsWith('.html') || fullPath.endsWith('.js') && file !== 'remove_html_ext.js') {
            processFile(fullPath);
        }
    }
}

walk(dir);
console.log("Replacement complete.");
