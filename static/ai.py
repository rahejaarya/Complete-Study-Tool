import ollama
from ddgs import DDGS

MODEL = "qwen3.5:2b"


def ask_ai(user_input, web_context=""):
    try:
        response = ollama.chat(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": """You are a helpful study assistant.

Keep your answers SHORT and useful by default.

For normal questions:
- Usually use 1-3 short paragraphs.
- Aim for roughly 60-150 words.
- Use a few bullet points when they make the answer easier to understand.
- Give the user the important information without unnecessary background.
- Do not repeat the question.
- Do not add a long introduction or conclusion.

For very simple messages such as "hi", "hello", "thanks", etc.:
- Reply naturally in 1-2 sentences.
- Do not provide a lesson or unnecessary information.

Only give a longer response if the user specifically asks for:
- a detailed explanation
- an in-depth explanation
- a full lesson
- comprehensive notes
- step-by-step detail
- more information

If web information is provided below, use it when it is relevant.
Do not mention the web search itself.

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
        yield f"Error: {e}"


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


def find_resource(query):
    try:
        query_clean = query.lower().strip()

        # Don't recommend resources for casual conversation.
        casual_messages = {
            "hi",
            "hello",
            "hey",
            "hiya",
            "yo",
            "sup",
            "what's up",
            "whats up",
            "good morning",
            "good afternoon",
            "good evening",
            "thanks",
            "thank you",
            "ok",
            "okay",
            "cool",
            "nice",
            "great"
        }

        if query_clean in casual_messages:
            return None

        # Search specifically for educational videos.
        videos = DDGS().videos(
            query + " explained educational",
            region="us-en",
            safesearch="moderate",
            max_results=5
        )

        if videos:
            for video in videos:
                title = video.get("title", "").strip()
                description = video.get("description", "").strip()
                url = video.get("content", "").strip()

                # Make sure the result actually has usable information.
                if not title or not url:
                    continue

                image = (
                    video.get("images", {}).get("medium")
                    or video.get("images", {}).get("small")
                    or ""
                )

                return {
                    "type": "Video",
                    "title": title,
                    "description": (
                        description
                        or "An educational video to help you learn more about this topic."
                    )[:140],
                    "url": url,
                    "image": image
                }

        # Fall back to an educational article.
        results = search_web(
            query + " explained educational"
        )

        for result in results:
            if result.get("title") and result.get("url"):
                return {
                    "type": "Article",
                    "title": result["title"],
                    "description": result.get(
                        "description",
                        "An educational resource to help you learn more about this topic."
                    )[:140],
                    "url": result["url"],
                    "image": ""
                }

    except Exception as e:
        print(f"Resource search error: {e}")

    return None


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