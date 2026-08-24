#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <png-directory> <svg-directory>" >&2
  exit 2
fi

png_directory=$1
svg_directory=$2

mkdir -p "$svg_directory"

for png_path in "$png_directory"/*.png; do
  [[ -e "$png_path" ]] || continue

  file_name=$(basename "$png_path" .png)
  pixel_width=$(sips -g pixelWidth "$png_path" | awk '/pixelWidth:/ { print $2 }')
  pixel_height=$(sips -g pixelHeight "$png_path" | awk '/pixelHeight:/ { print $2 }')
  png_base64=$(base64 < "$png_path" | tr -d '\n')

  printf '%s\n' \
    '<?xml version="1.0" encoding="UTF-8"?>' \
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"$pixel_width\" height=\"$pixel_height\" viewBox=\"0 0 $pixel_width $pixel_height\" role=\"img\" aria-labelledby=\"title description\">" \
    "  <title id=\"title\">CAIPE $file_name feature surface</title>" \
    '  <desc id="description">Privacy-safe product capture from the CAIPE open-source user interface.</desc>' \
    "  <image width=\"$pixel_width\" height=\"$pixel_height\" href=\"data:image/png;base64,$png_base64\"/>" \
    '</svg>' \
    > "$svg_directory/$file_name.svg"
done
