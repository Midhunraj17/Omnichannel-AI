const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const sendMessage = async (message) => {

    const response = await fetch(
        `${API_BASE_URL}/ai/chat`,
        {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                message
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {

        throw new Error(
            data.detail || data.message || 'Request failed'
        );

    }

    return data;

};