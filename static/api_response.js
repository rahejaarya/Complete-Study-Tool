(() => {
    async function read(response, fallbackMessage) {
        const contentType = response.headers.get("Content-Type") || "";
        const isJson = /(?:application\/json|application\/[^;]+\+json)/i.test(contentType);

        if (!isJson) {
            const pathname = (() => {
                try {
                    return new URL(response.url).pathname;
                } catch {
                    return "unknown endpoint";
                }
            })();
            console.warn("API returned a non-JSON response", {
                endpoint: pathname,
                status: response.status,
                contentType: contentType || "missing"
            });
            if (response.status === 401 || response.redirected) {
                throw new Error("Your session may have expired. Sign in again and retry.");
            }
            throw new Error(
                `The server returned an unexpected response (HTTP ${response.status}). Please retry.`
            );
        }

        let data;
        try {
            data = await response.json();
        } catch {
            console.warn("API returned invalid JSON", {
                status: response.status,
                contentType
            });
            throw new Error("The server response could not be read. Please retry.");
        }

        if (!response.ok) {
            throw new Error(
                typeof data?.error === "string" ? data.error : fallbackMessage
            );
        }
        return data;
    }

    window.MeridianApi = { read };
})();
