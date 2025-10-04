from flask import Flask, render_template, request, redirect, jsonify, current_app, abort, url_for

app = Flask(__name__)

#Halaman Utama
@app.route('/')
def home():
  return render_template('index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
    # app.run(debug=True)
