const { Actor } = require('apify');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const WebTorrent = require('webtorrent');

function zipDirectory(sourceDir, outputFilePath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

Actor.main(async () => {
    const input = await Actor.getInput();
    const magnetUrl = input?.magnetUrl;
    const clientId = input?.clientId;
    const clientSecret = input?.clientSecret;
    const refreshToken = input?.refreshToken;
    const folderId = input?.folderId;

    if (!magnetUrl || !magnetUrl.startsWith('magnet:?')) {
        throw new Error('Invalid magnet URL. It must start with magnet:?');
    }

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Google Drive credentials: clientId, clientSecret, refreshToken are required.');
    }

    const workDir = path.join(process.cwd(), 'tmp', String(Date.now()));
    const downloadDir = path.join(workDir, 'download');
    const zipDir = path.join(workDir, 'zip');
    const zipPath = path.join(zipDir, 'download.zip');

    fs.mkdirSync(downloadDir, { recursive: true });
    fs.mkdirSync(zipDir, { recursive: true });

    let webtorrentClient = null;

    try {
        console.log('Starting torrent download...');
        webtorrentClient = new WebTorrent();

        // Validate magnet URL before adding
        if (!magnetUrl || typeof magnetUrl !== 'string') {
            throw new Error('Invalid magnet URL: must be a non-empty string');
        }

        console.log('Adding torrent:', magnetUrl.substring(0, 50) + '...');
        
        let torrent;
        try {
            torrent = webtorrentClient.add(magnetUrl, { path: downloadDir });
        } catch (addError) {
            throw new Error(`Failed to add torrent: ${addError.message}`);
        }

        // Add timeout for torrent download (30 minutes)
        const downloadTimeout = setTimeout(() => {
            webtorrentClient.destroy();
            throw new Error('Torrent download timeout after 30 minutes');
        }, 30 * 60 * 1000);

        await new Promise((resolve, reject) => {
            torrent.on('done', () => {
                clearTimeout(downloadTimeout);
                console.log('Torrent download finished.');
                resolve();
            });

            torrent.on('error', (err) => {
                clearTimeout(downloadTimeout);
                reject(new Error(`Torrent error: ${err.message || err}`));
            });
        });

        console.log('Creating ZIP archive...');
        await zipDirectory(downloadDir, zipPath);

        // Verify ZIP was created
        if (!fs.existsSync(zipPath)) {
            throw new Error('ZIP file was not created successfully');
        }

        const oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret
        );

        oauth2Client.setCredentials({
            refresh_token: refreshToken
        });

        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const metadata = {
            name: path.basename(zipPath)
        };

        if (folderId) {
            metadata.parents = [folderId];
        }

        console.log('Uploading ZIP to Google Drive...');
        const response = await drive.files.create({
            resource: metadata,
            media: {
                mimeType: 'application/zip',
                body: fs.createReadStream(zipPath)
            },
            fields: 'id,name,webViewLink'
        });

        // Verify upload was successful
        if (!response.data.id) {
            throw new Error('Google Drive upload failed - no file ID returned');
        }

        const result = {
            magnetUrl,
            fileId: response.data.id,
            fileName: response.data.name,
            webViewLink: response.data.webViewLink || null,
            folderId: folderId || null,
            zipPath
        };

        await Actor.pushData(result);

        console.log('Upload complete.');
        console.log(JSON.stringify(result, null, 2));

        await Actor.setValue('OUTPUT', result);

    } finally {
        // Cleanup
        if (webtorrentClient) {
            webtorrentClient.destroy();
        }

        // Remove temporary directories
        try {
            if (fs.existsSync(workDir)) {
                fs.rmSync(workDir, { recursive: true, force: true });
                console.log('Cleaned up temporary directories');
            }
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError.message);
        }
    }
});
