#include <stdio.h>
#include <stdlib.h>
#include <dirent.h>

#include "./pnglite.h"

#define ICON_PATH "icons"
#define EXPECTED_WIDTH 128
#define EXPECTED_HEIGHT 64
#define MAX_BPP 32

int main(void) {
	if (png_init(malloc, free) != PNG_NO_ERROR)
		return 1;

	DIR *dir = opendir(ICON_PATH);
	if (dir == NULL) {
		perror("opendir");
		return 1;
	}

	unsigned int errors = 0;
	unsigned int files = 0;
	unsigned char data[EXPECTED_WIDTH * EXPECTED_HEIGHT * MAX_BPP];

	struct dirent* entry = NULL;
	while ((entry = readdir(dir)) != NULL) {
		const char* name = entry->d_name;
		if (name[0] == '.')
			continue;

		++files;

		char filename[256];
		int n = snprintf(filename, sizeof(filename), "%s/%s", ICON_PATH, entry->d_name);
		if (n < 0 || (size_t)n >= sizeof(filename)) {
			fprintf(stderr, "Path too long: %s\n", name);
			++errors;
			continue;
		}

		int png_error = PNG_NO_ERROR;
		png_t png = {0};

		if ((png_error = png_open_file_read(&png, filename)) != PNG_NO_ERROR) {
			fprintf(stderr, "Failed to open image %s: %s\n",
				name, png_error_string(png_error));
			++errors;
			continue;
		}

		if (png.width != EXPECTED_WIDTH || png.height != EXPECTED_HEIGHT) {
			fprintf(stderr, "Image %s is wrong size: %dx%d (expected %dx%d)\n",
				name, png.width, png.height, EXPECTED_WIDTH, EXPECTED_HEIGHT);
			++errors;
			if (png.width > EXPECTED_WIDTH || png.height > EXPECTED_HEIGHT)
				goto error; // Image cannot fit into `data`
		}

		if (png.bpp > MAX_BPP) {
			fprintf(stderr, "Image %s has large BPP: %d (max %d)\n",
				name, png.bpp, MAX_BPP);
			++errors;
			goto error;
		}

		if ((png_error = png_get_data(&png, data)) != PNG_NO_ERROR) {
			fprintf(stderr, "Failed to read image %s: %s\n",
				name, png_error_string(png_error));
			++errors;
			goto error;
		}

		error:
			if ((png_error = png_close_file(&png)) != PNG_NO_ERROR) {
				fprintf(stderr, "Failed to close image %s: %s\n",
					entry->d_name, png_error_string(png_error));
				++errors;
			}
	}
	closedir(dir);

	printf("Read %u files, %u errors\n", files, errors);

    if (errors > 0) {
    	printf("Images must be %dx%d PNG%d images with no interlacing\n", EXPECTED_WIDTH, EXPECTED_HEIGHT, MAX_BPP);
     	printf("If the error is caused by the format (not size) of the image, try the following script\n");
      	printf("magick input.png -strip -depth 8 -define png:color-type=6 -define png:bit-depth=8 -interlace none PNG32:output.png\n");
    }

    return errors > 0 ? 1 : 0;
}
