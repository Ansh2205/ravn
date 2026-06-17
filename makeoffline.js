const fs = require('fs');
const path = require('path');
const https = require('https');

console.log("🚀 Starting RAVN Offline Asset Downloader...");

// The CDN links used in your HTML files
const TAILWIND_CDN = 'https://cdn.tailwindcss.com';
const PHOSPHOR_CDN = 'https://unpkg.com/@phosphor-icons/web';

const assetsDir = path.join(__dirname, 'assets');

// Create an assets folder if it doesn't exist
if (!fs.existsSync(assetsDir)){
    fs.mkdirSync(assetsDir);
}

// Function to download a file
const downloadFile = (url, destPath) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                // Handle redirects properly by combining the base URL with the relative path
                const redirectUrl = new URL(response.headers.location, url).href;
                return downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
};

async function buildOfflineEngine() {
    try {
        console.log("⬇️ Downloading Tailwind CSS Engine...");
        await downloadFile(TAILWIND_CDN, path.join(assetsDir, 'tailwind.js'));
        console.log("✅ Tailwind CSS downloaded successfully.");

        console.log("⬇️ Downloading Phosphor Icons Engine...");
        await downloadFile(PHOSPHOR_CDN, path.join(assetsDir, 'phosphor.js'));
        console.log("✅ Phosphor Icons downloaded successfully.");

        // Now we need to update the HTML files to use the local assets
        console.log("🔄 Updating HTML files to use local assets...");
        
        const htmlFiles = fs.readdirSync(__dirname).filter(file => file.endsWith('.html'));
        let modifiedCount = 0;

        htmlFiles.forEach(file => {
            const filePath = path.join(__dirname, file);
            let content = fs.readFileSync(filePath, 'utf8');
            let isModified = false;

            // Replace Tailwind CDN
            if (content.includes('https://cdn.tailwindcss.com')) {
                content = content.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/g, '<script src="assets/tailwind.js"></script>');
                isModified = true;
            }

            // Replace Phosphor Icons CDN
            if (content.includes('https://unpkg.com/@phosphor-icons/web')) {
                content = content.replace(/<script src="https:\/\/unpkg\.com\/@phosphor-icons\/web"><\/script>/g, '<script src="assets/phosphor.js"></script>');
                isModified = true;
            }

            // Remove old PWA Service Worker stuff if it exists
            if (content.includes('navigator.serviceWorker.register')) {
                content = content.replace(/<!-- RAVN Offline PWA Engine -->[\s\S]*?<\/script>/g, '');
                isModified = true;
            }
            
            if (content.includes('manifest.json')) {
                content = content.replace(/<link rel="manifest" href="\/manifest\.json">\n/g, '');
                isModified = true;
            }

            if (isModified) {
                fs.writeFileSync(filePath, content);
                modifiedCount++;
            }
        });

        console.log(`✅ Updated ${modifiedCount} HTML files to work offline.`);
        
        // Cleanup old PWA files if they exist
        if(fs.existsSync(path.join(__dirname, 'sw.js'))) {
            fs.unlinkSync(path.join(__dirname, 'sw.js'));
            console.log("🧹 Removed old sw.js");
        }
        if(fs.existsSync(path.join(__dirname, 'manifest.json'))) {
            fs.unlinkSync(path.join(__dirname, 'manifest.json'));
            console.log("🧹 Removed old manifest.json");
        }

        console.log("\n🎉 SUCCESS! Your RAVN website front-end will now run 100% offline.");

    } catch (error) {
        console.error("❌ Offline Engine Build Failed:", error);
    }
}

buildOfflineEngine();