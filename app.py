from flask import Flask, render_template
from api import api_bp

app = Flask(__name__)
app.register_blueprint(api_bp)

@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    app.run(debug=True)
