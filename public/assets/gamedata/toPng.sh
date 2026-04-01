#!/bin/bash

# Loop through all files in the current directory
for file in *; do
    # Check if it's a regular file (skips directories and the script itself)
    if [ -f "$file" ] && [ "$file" != "copy_to_png.sh" ]; then
        # Copy the file and append .png to the destination name
        cp "$file" "$file.png"
        echo "Created: $file.png"
    fi
done

echo "Done! All files have been copied with a .png extension."
