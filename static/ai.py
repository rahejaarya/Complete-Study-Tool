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
            think=False
        )

        return response["message"]["content"]

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

        answer = ask_ai(user_input)

        print(f"\nAI: {answer}\n")
