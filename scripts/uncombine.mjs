#!/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const { communities } = JSON.parse(
	await fs.readFile("custom-communities-ddnet-info.json"),
);

for (const {
	id,
	name,
	icon: { servers: regions },
	contact_urls: contactUrls,
} of communities) {
	const server = { name, contactUrls, regions };
	const filename = path.join("data", id) + ".json";
	const stat = await fs.stat(filename, { throwIfNoEntry: false });
	if (stat !== undefined) {
		console.warn(`Skipping already present ${filename}`);
		continue;
	}
	await fs.writeFile(filename, JSON.stringify(server, null, "\t"));
}
