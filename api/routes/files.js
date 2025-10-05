const { exec } = require('child_process');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const busboy = require('busboy');

const router = express.Router();

function executeCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stderr });
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

// curl -H "url: https://www.youtube.com/watch?v=wg8LfFX0rnQ" http://localhost:3000/url-to-mp3 --output cream.mp3
router.get('/url-to-mp3', async (req, res) => {
    // Get URL from header
    const url = req.headers['url'];
    if (!url) {
        return res.status(400).json({ error: 'Missing url header' });
    }
    console.log('Received URL from header:', url);

    // Run yt-dlp mp3 extract
    try  {
        let file_name = crypto.randomUUID();
        const result = await executeCommand(`yt-dlp -x --audio-format mp3 -o "./files/${file_name}.mp3" ${url}`);
        console.log(result)
    }
    catch (err) {
        console.error('Error executing yt-dlp:', err);
        return res.status(500).json({ error: 'Failed to process the URL' });
    }

    // Return mp3
    const filePath = path.join(__dirname, `../files/${file_name}.mp3`);
    res.sendFile(filePath);
});


// curl -X POST http://localhost:3000/mp3-to-mid -F "mid_file=@autumn.mp3" --output midivid.mp4
router.post('/mp3-to-mid', (req, res) => {
    const bb = busboy({ headers: req.headers });
    let fileBuffer = null;
    let mp3_name = null;

    bb.on('file', (name, file, info) => {
        if (name === 'mp3_file') {
            mp3_name = info.filename;
            const chunks = [];

            file.on('data', (chunk) => {
                chunks.push(chunk);
            });

            file.on('end', () => {
                fileBuffer = Buffer.concat(chunks);
            });
        } else {
            file.resume(); // discard non-file fields
        }
    });

    bb.on('close', async () => {
        if (fileBuffer) {
            console.log(`Received file: ${mp3_name}, size: ${fileBuffer.length}`);
            try {
                const inputPath = path.join(__dirname, `../files/${mp3_name}`);
                fs.writeFileSync(inputPath, fileBuffer);
                mp3_name = mp3_name.substring(0, mp3_name.lastIndexOf('.'));
                const result = await executeCommand(`bash ./export-mp4.sh ./files/${mp3_name}.mid`);
                const filePath = path.join(__dirname, `../files/${mp3_name}.mp4`);
                res.sendFile(filePath);
            }
            catch (err) {
                console.error('Error executing export-mp4.sh:', err);
                return res.status(500).json({ error: 'Failed to convert MIDI to MP4' });
            }
        } else {
            res.status(400).json({ error: 'No file received' });
        }
    });

    req.pipe(bb);
});

// curl -X POST http://localhost:3000/mid-to-mp4 -F "mid_file=@autumn.mid" --output midivid.mp4
router.post('/mid-to-mp4', (req, res) => {
    const bb = busboy({ headers: req.headers });
    let fileBuffer = null;
    let midi_name = null;

    bb.on('file', (name, file, info) => {
        if (name === 'mid_file') {
            midi_name = info.filename;
            const chunks = [];

            file.on('data', (chunk) => {
                chunks.push(chunk);
            });

            file.on('end', () => {
                fileBuffer = Buffer.concat(chunks);
            });
        } else {
            file.resume(); // discard non-file fields
        }
    });

    bb.on('close', async () => {
        if (fileBuffer) {
            console.log(`Received file: ${midi_name}, size: ${fileBuffer.length}`);
            try {
                const inputPath = path.join(__dirname, `../files/${midi_name}`);
                fs.writeFileSync(inputPath, fileBuffer);
                midi_name = midi_name.substring(0, midi_name.lastIndexOf('.'));
                const result = await executeCommand(`bash ./export-mp4.sh ./files/${midi_name}.mid`);
                const filePath = path.join(__dirname, `../files/${midi_name}.mp4`);
                res.sendFile(filePath);
            }
            catch (err) {
                console.error('Error executing export-mp4.sh:', err);
                return res.status(500).json({ error: 'Failed to convert MIDI to MP4' });
            }
        } else {
            res.status(400).json({ error: 'No file received' });
        }
    });

    req.pipe(bb);
});

module.exports = router;