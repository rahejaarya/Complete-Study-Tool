import json
import os
from flask import Flask, render_template, request

app = Flask(__name__)

def load_resources():
    json_path = os.path.join(app.root_path, 'data', 'resources.json')
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/resources")
def resources():
    query = request.args.get('query', '').strip().lower()
    all_resources = load_resources()
    
    if query:
        filtered_resources = [
            item for item in all_resources
            if query in item.get('title', '').lower() 
            or query in item.get('subject', '').lower() 
            or query in item.get('description', '').lower()
        ]
    else:
        filtered_resources = all_resources

    return render_template("resources.html", resources=filtered_resources, query=query)

@app.route("/focus")
def focus():
    return render_template("focus.html")

@app.route("/schedule")
def schedule():
    return render_template("schedule.html")

@app.route("/support")
def support():
    return render_template("support.html")
# can u add a new route for the time management page? gtg cya
@app.route("/ai")
def ai_help():
    return render_template("ai.html")

if __name__ == "__main__":
    app.run(debug=True)

@app.route('/focus')
def focus():
    return render_template('focus.html')