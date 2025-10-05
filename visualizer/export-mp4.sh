# first argument is input file and it is automatically generated in the same directory as terminal running the script.

input_file="$1"

name="${input_file##*/}"
name="${name%.*}"
video_file="./midi-v-$$.mp4"
audio_file="./midi-a-$$.mp3"

cleanup() {
    rm -f "$video_file" "$audio_file"
}
trap cleanup EXIT


run_with_display(){
    if [ -z "$DISPLAY" ]; then
    #use virtual framebuffer
        xvfb-run -s "-screen 0 1280x720x24" "$@"
    else 
        "$@"
    fi
        
}

#Generate video (headless)
run_with_display ./MIDIVisualizer \
    --midi "$input_file" \
    --format MPEG4 \
    --size 1280 720 \
    --hide-window \
    --bitrate 2 \
    --preroll 1 \
    --quality LOW_RES \
    --show-pedal 0 \
    --framerate 30 \
    --export "$video_file"
    


# Generate Audio
timidity $1 -Ow -o - | ffmpeg -i - -f mp3 -acodec libmp3lame -ab 192k "$audio_file"

# Combine!
ffmpeg -i "$video_file" -i "$audio_file" -filter_complex "[1:a]adelay=1250|1250[a]" -map 0:v -map "[a]" -c:v copy -c:a aac "${name}.mp4"
