import { useState } from 'react';

import { sendMessage } from './services/api';

function App() {

    const [message, setMessage] = useState('');

    const [response, setResponse] = useState('');

    const [loading, setLoading] = useState(false);

    const [error, setError] = useState('');

    const handleSubmit = async (e) => {

        e.preventDefault();

        if (!message.trim()) return;

        setLoading(true);

        setResponse('');

        setError('');

        try {

            const result = await sendMessage(message);

            setResponse(result.response);

        } catch (error) {

            setError(error.message);

        } finally {

            setLoading(false);

        }

    };


    return (

        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">

            <div className="w-full max-w-2xl">

                <h1 className="text-4xl font-bold text-center">

                    Omnichannel AI

                </h1>

                <p className="text-slate-400 text-center mt-3">

                    AI Integration Testing Interface

                </p>


                <form
                    onSubmit={handleSubmit}
                    className="mt-10 flex gap-3"
                >

                    <input

                        type="text"

                        value={message}

                        onChange={(e) => setMessage(e.target.value)}

                        placeholder="Ask something..."

                        className="flex-1 rounded-lg bg-slate-800 p-4 outline-none"

                    />


                    <button

                        type="submit"

                        disabled={loading}

                        className="rounded-lg bg-blue-600 px-6 disabled:opacity-50"

                    >

                        {loading ? 'Thinking...' : 'Send'}

                    </button>

                </form>


                {response && (

                    <div className="mt-8 rounded-xl bg-slate-800 p-6">

                        <h2 className="font-semibold text-green-400">

                            AI Response

                        </h2>

                        <p className="mt-3 text-slate-200">

                            {response}

                        </p>

                    </div>

                )}


                {error && (

                    <p className="mt-6 text-red-400">

                        {error}

                    </p>

                )}

            </div>

        </div>

    );

}

export default App;