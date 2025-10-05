import yt_dlp
import os
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('url', type=str, help= 'Youtube video or playlist URL')
args = parser.parse_args()

youtube_url = args.url

OUTPUT_DIRECTORY = "downloads"
os.makedirs(OUTPUT_DIRECTORY, exist_ok=True)

cli_defaults = {
    'fragment_retries' : 10,
    'ignoreerrors': 'only_download',
    'retries': 10,
    'warn_when_outdated': True
}

ydl_opts = {
    **cli_defaults,
    'format': 'bestaudio/best',
    'postprocessors':[
        {
            'key': 'FFmpegExtractAudio', #convert to mp3
            'preferredcodec': 'mp3',
            'preferredquality': '0'


        },
        *cli_defaults.get('postprocessors', []) # keep CLI postprocessors
    ],
    'outtmpl' : f'{OUTPUT_DIRECTORY}/%(uploader)s - %(title)s.%(ext)s',
    
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download([youtube_url])