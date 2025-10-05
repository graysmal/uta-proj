import React, { useRef, useState } from "react"
import Visualizer from "./Visualizer.jsx"

export default function App(){
    const [midi, setMIDI] = useState(null);
    const [tutorial, setTutorial] = useState(null);
    const [showVisualizer, setShowVisualizer] = useState(false);
    const [loading, setLoading] = useState(false);
    const toggleVisualizer = () => {
        setShowVisualizer(prevIsToggled => !prevIsToggled);
    };
    const [url_input, setUrlInput] = useState("");

    const fileInputRef = useRef(null);

    const handleButtonClick = () => {
        fileInputRef.current.click();
    };

    const handleFileChange = (e) => {
        setLoading(false);
        const file = e.target.files[0];
        if (file) {
            setMIDI(file);
            setLoading(false);
            setShowVisualizer(true);
            createTutorial(file);
        }
    };

    const createTutorial = async (file) => {
        const formData = new FormData();
        formData.append("mid_file", file); // Assuming `midi` is the file
        console.log("attempting to create tutorial");
        try {
            const response = await fetch("http://localhost:3000/mid-to-mp4", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error("Failed to upload MIDI file");
            }

            const blob = await response.blob();
            console.log("Tutorial created successfully");
            setTutorial(blob);
        } catch (error) {
            console.error("Error:", error);
        }
    };

    const handleURL = async (e) => {
        e.preventDefault();
        setLoading(true);
        console.log(url_input);
        const response = await fetch("/api/youtube-to-midi", {
            method: 'GET',
            headers: {
                'url': url_input
            }
        });
        const blob = await response.blob();
        setMIDI(blob);
        setLoading(false);
        setShowVisualizer(true);
        const formData = new FormData();
        createTutorial(blob);
    };
    if (loading) {
        return (
            <div className="h-screen flex flex-col justify-center items-center text-4xl font-extrabold text-blue-900">
                <div className="flex flex-col justify-center">
                    <img width={500} className={"pb-16 top-1 drop-shadow-lg"} src={"/pianoani.png"} />
                </div>
                <p>Loading...</p>
            </div>
        )
    }
    if (showVisualizer) {
        return (
            <div>
                <button onClick={toggleVisualizer} className={"w-16 top-4 left-4 absolute hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl text-amber-50 font-extrabold font- text-3xl"}>⇦</button>
                <button
                    onClick={() => {
                        if (midi) {
                            const url = URL.createObjectURL(midi);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "downloaded-midi.mid";
                            a.click();
                            URL.revokeObjectURL(url);
                        } else {
                            console.error("No MIDI file available to download.");
                        }
                    }}
                    className={"top-4 right-4 absolute hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl text-amber-50 font-extrabold font- text-3xl"}
                >
                    Download MIDI</button>
                    <button
                        onClick={() => {
                            if (tutorial) {
                                const url = URL.createObjectURL(tutorial);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = "downloaded-midi.mp4";
                                a.click();
                                URL.revokeObjectURL(url);
                            } else {
                                console.error("No MIDI file available to download.");
                            }
                        }}
                        disabled={!tutorial}
                        className={`top-4 right-70 absolute  duration-150  bg-blue-900 p-4 rounded-2xl text-amber-50 font-extrabold text-3xl ${
                            !tutorial ? "opacity-50 cursor-not-allowed" : "hover:rotate-1 hover:scale-102 hover:bg-blue-950 cursor-pointer"}`}
                    >
                        DL Tut mp4</button>
                <button hidden onClick={toggleVisualizer} className={"w-16 top-4 left-4 absolute hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl text-amber-50 font-extrabold font- text-3xl"}>⇦</button>
                <Visualizer midi={midi} />
            </div>

        )
    }
      return (
        <div className={"appear h-screen flex flex-col justify-center p-4 bg-radial-[at_50%_50%] from-[#85a4e1] to-70% to-[#95b0e2]\""}>
            <div className="flex justify-center">
                <img width={1000} className={"pb-16 top-1 drop-shadow-lg"} src={"/webscore.png"} />
            </div>
            <div className={"flex justify-center"}>
            <form className={"flex gap-4"}>
              <input value={url_input} onChange={e => setUrlInput(e.target.value)}
                  placeholder={"Insert link here"}
                     className={"shadow-lg bg-radial-[at_25%_25%] from-[rgba(255,255,255,0.5)] to-[rgba(200, 200, 255, 0.5)]  to-99%  backdrop-blur-md inset-shadow-md inset-shadow-white-400 p-4 rounded-2xl w-164 text-blue-900 text-3xl"} />
              <button onClick={handleURL} className={"hover:rotate-1 hover:shadow-xl shadow-lg  hover:scale-102 hover:bg-[rgba(0,0,255,0.05)] duration-150 bg-radial-[at_25%_25%] from-[rgba(255,255,255,0.5)] to-[rgba(129, 151, 255, 0.5)]  to-75%  backdrop-blur-md cursor-pointer p-4 rounded-2xl w-32 text-[#6b7eba] font-extrabold text-3xl"}>Score</button>
            </form>
          </div>
          <div className={"flex justify-center bottom-2 justify-center m-auto left-0 right-0 gap-4 absolute"}>
            <button hidden className={"w-64 hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl w-32 text-amber-50 font-extrabold font- text-3xl"}>Upload MP3</button>
              <div>
                  <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: "none" }}
                      onChange={handleFileChange}
                  />
                  <button
                      onClick={handleButtonClick}
                      className="w-64 hover:rotate-1 hover:scale-102 hover:bg-blue-950 duration-150 cursor-pointer bg-blue-900 p-4 rounded-2xl text-amber-50 font-extrabold text-3xl"
                  >
                      Upload MIDI
                  </button>
              </div>
          </div>
        </div>

      )
}
