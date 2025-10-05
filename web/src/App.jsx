import React, { useRef, useState } from "react"
import Visualizer from "./Visualizer.jsx"

export default function App(){
    const [midi, setMIDI] = useState(null);
    const [showVisualizer, setShowVisualizer] = useState(false);
    const toggleVisualizer = () => {
        setShowVisualizer(prevIsToggled => !prevIsToggled);
    };
    const [url_input, setUrlInput] = useState("");

    const handleURL = async (e) => {
        e.preventDefault();
        console.log(url_input);
        const response = await fetch("http://localhost:3000/url-to-mp3", {
            method: 'GET',
            headers: {
                'url': url_input
            }
        });
        const blob = await response.blob();
        setMIDI(blob);
        setShowVisualizer(true);
    };
    if (showVisualizer) {
        return (
            <div>
                <audio src={"midi"} controls ></audio>
                <button onClick={toggleVisualizer} className={"w-16 top-4 left-4 absolute hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl text-amber-50 font-extrabold font- text-3xl"}>⇦</button>
                <Visualizer midiBlob={midi} />
            </div>

        )
    }
      return (
        <div className={"appear h-screen flex flex-col justify-center p-4 bg-radial-[at_50%_50%] from-[#85a4e1] to-70% to-[#95b0e2]\""}>
          <div className={"flex justify-center"}>
            <form className={"flex gap-4"}>
              <input value={url_input} onChange={e => setUrlInput(e.target.value)}
                  placeholder={"https://www.youtube.com/watch?v=[---------]"}
                     className={"shadow-lg bg-radial-[at_25%_25%] from-[rgba(255,255,255,0.5)] to-[rgba(200, 200, 255, 0.5)]  to-99%  backdrop-blur-md inset-shadow-md inset-shadow-white-400 p-4 rounded-2xl w-164 text-blue-900 text-3xl"} />
              <button onClick={handleURL} className={"hover:rotate-1 hover:shadow-xl shadow-lg  hover:scale-102 hover:bg-[rgba(0,0,255,0.05)] duration-150 bg-radial-[at_25%_25%] from-[rgba(255,255,255,0.5)] to-[rgba(129, 151, 255, 0.5)]  to-75%  backdrop-blur-md cursor-pointer p-4 rounded-2xl w-32 text-[#6b7eba] font-extrabold text-3xl"}>Score</button>
            </form>
          </div>
          <div className={"flex justify-center bottom-2 justify-center m-auto left-0 right-0 gap-4 absolute"}>
            <button className={"w-64 hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl w-32 text-amber-50 font-extrabold font- text-3xl"}>Upload MP3</button>
            <button className={"w-64 hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl w-32 text-amber-50 font-extrabold font- text-3xl"}>Upload MIDI</button>
          </div>
        </div>

      )
}
