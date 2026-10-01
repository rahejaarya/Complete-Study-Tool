import ollama

MODEL = "qwen3.5:2b"


def ask_ai(user_input):
    try:
        response = ollama.chat(
            model=MODEL,
            messages=[
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

