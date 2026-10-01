import ollama

MODEL = "qwen3.5:2b"


def ask_ai(user_input, web_context=""):
    try:
        response = ollama.chat(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": """You are a helpful study assistant.

            Keep answers relatively short by default. Usually answer in 2-5 short paragraphs or a small number of bullet points.

            Explain things clearly and naturally without unnecessary detail.

            Only give a long, detailed explanation when the user asks for more detail, a deep explanation, notes, or a full lesson.

            If web information is provided below, use it to improve accuracy and currentness. Do not mention the web search unless it is relevant to the answer.

            Web information:
            """ + web_context
                },
                {
                    "role": "user",
                    "content": user_input
                }
            ],

            think=False,
            stream=True
        )

        for chunk in response:
            yield chunk["message"]["content"]

    except Exception as e:
        return f"Error: {e}"

def search_web(query):
    try:
        results = DDGS().text(
            query,
            region="us-en",
            safesearch="moderate",
            max_results=5
        )

        cleaned = []

        for result in results:
            cleaned.append({
                "title": result.get("title", ""),
                "url": result.get("href", ""),
                "description": result.get("body", "")
            })

        return cleaned

    except Exception as e:
        print(f"Web search error: {e}")
        return []


if __name__ == "__main__":
    print("Local AI started.")
    print("Type 'exit' to quit.\n")

    while True:
        user_input = input("You: ")

        if user_input.lower() == "exit":
            print("Goodbye!")
            break

        print("\nAI: ", end="", flush=True)

        for chunk in ask_ai(user_input):
            print(chunk, end="", flush=True)

        print("\n")

