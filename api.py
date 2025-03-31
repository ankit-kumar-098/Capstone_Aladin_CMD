from flask import Blueprint, request, jsonify, send_from_directory
import os
import requests

api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/cmd', methods=['POST'])
def generate_cmd():
    data = request.json
    ra = data.get('ra')
    dec = data.get('dec')
    radius = data.get('radius', 0.2)
    if not ra or not dec:
        return jsonify({"error": "Missing RA or Dec"}), 400

    # Try a different catalog with better coverage
    # I/345/gaia2 is Gaia DR2, which has full sky coverage
    url = f"https://vizier.cds.unistra.fr/viz-bin/votable?-source=I/345/gaia2&-c={ra} {dec}&-c.r={radius}&-out=RA_ICRS,DE_ICRS,Gmag,BPmag,RPmag"
    res = requests.get(url)
    return res.text, 200, {'Content-Type': 'application/xml'}

@api_bp.route('/isochrone', methods=['GET'])
def get_isochrone():
    age = request.args.get('age', 'parsec_9.0')
    z = request.args.get('z', '0.019')
    filename = f"{age}_z{z.replace('.', '')}.json"

    isochrone_dir = os.path.join('static', 'isochrones')
    full_path = os.path.join(isochrone_dir, filename)

    if not os.path.exists(full_path):
        return jsonify({"error": f"Isochrone file '{filename}' not found"}), 404

    return send_from_directory(isochrone_dir, filename)

@api_bp.route('/finder_chart', methods=['GET'])
def finder_chart():
    ra = request.args.get('ra')
    dec = request.args.get('dec')
    scale = request.args.get('scale', '0.2')
    width = request.args.get('width', '120')
    height = request.args.get('height', '120')

    if not ra or not dec:
        return jsonify({"error": "Missing RA or Dec"}), 400

    base_url = "https://skyserver.sdss.org/dr16/SkyServerWS/ImgCutout/getjpeg"
    chart_url = f"{base_url}?ra={ra}&dec={dec}&scale={scale}&width={width}&height={height}"

    return jsonify({ "finder_chart_url": chart_url })
