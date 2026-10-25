#!/bin/env node

import path from "path";
import { URL } from "url";
import fs from "fs/promises";

async function exists(path) {
	try {
		await fs.access(path);
		return true;
	} catch (e) {
		return false;
	}
}

let CIFailed = false;
const noEdit = process.argv[2] === "--noedit";
function CIError(msg) {
	console.error(msg);
	CIFailed = true;
}
async function CIErrorFixable(msg, fix) {
	if (noEdit) {
		console.warn(msg + " (fixable)");
		CIFailed = true;
	} else {
		console.error(msg + " (fixed)");
		await fix();
	}
}

// Get server data
class IsUnqiue {
	constructor() {
		const data = new Set();
		return item => {
			if (data.has(item))
				return false;
			data.add(item);
			return true;
		}
	}
}
const IsIPUnique = new IsUnqiue();
const IsNameUnique = new IsUnqiue();
const IsIDUnique = new IsUnqiue();

const gamemodes = new Set();

const DDNET_INDEX_URL = "https://raw.githubusercontent.com/ddnet/ddnet/refs/heads/master/data/countryflags/index.txt";
const ISO_3166_CSV_URL = "https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.csv";

// DDNet and legacy aliases that appear in community data.
const CODE_ALIASES = {
	EUR: "EU",
	GER: "DE"
};

function parseCSVLine(line) {
	const out = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === "," && !inQuotes) {
			out.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	out.push(current);
	return out;
}

function parseDDNetIndex(indexText) {
	const lines = indexText
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith("#####") && !line.startsWith("#"));

	const codeToFlagId = new Map();
	let pendingCode;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("==")) {
			if (!pendingCode)
				continue;

			let value = line.slice(2).trim();
			if (value.length === 0 && i + 1 < lines.length)
				value = lines[++i];

			const parsed = Number.parseInt(value, 10);
			if (Number.isFinite(parsed))
				codeToFlagId.set(pendingCode, parsed);

			pendingCode = undefined;
			continue;
		}

		pendingCode = line.toUpperCase();
	}

	return codeToFlagId;
}

function parseIsoCodeMaps(csvText) {
	const lines = csvText.split(/\r?\n/).filter(Boolean);
	if (lines.length === 0)
		return { alpha2ToAlpha3: new Map(), alpha3ToAlpha2: new Map() };

	const header = parseCSVLine(lines[0]);
	const alpha2Index = header.indexOf("alpha-2");
	const alpha3Index = header.indexOf("alpha-3");

	if (alpha2Index === -1 || alpha3Index === -1)
		throw new Error("Could not find alpha-2/alpha-3 columns in ISO CSV.");

	const alpha2ToAlpha3 = new Map();
	const alpha3ToAlpha2 = new Map();
	for (let i = 1; i < lines.length; i++) {
		const row = parseCSVLine(lines[i]);
		const alpha2 = (row[alpha2Index] ?? "").toUpperCase().trim();
		const alpha3 = (row[alpha3Index] ?? "").toUpperCase().trim();
		if (alpha2.length === 2 && alpha3.length === 3) {
			alpha2ToAlpha3.set(alpha2, alpha3);
			alpha3ToAlpha2.set(alpha3, alpha2);
		}
	}

	return { alpha2ToAlpha3, alpha3ToAlpha2 };
}

function resolveDDNetCode(inputCode, alpha3ToAlpha2, DDNetCodeToFlagId) {
	const code = String(inputCode ?? "").toUpperCase().trim();
	if (code.length === 0)
		return undefined;

	const aliased = CODE_ALIASES[code] ?? code;
	if (DDNetCodeToFlagId.has(aliased))
		return aliased;

	if (/^[A-Z]{3}$/.test(aliased))
		return alpha3ToAlpha2.get(aliased);

	return undefined;
}

function buildFlagIdToDDNetCodes(DDNetCodeToFlagId) {
	const flagIdToDDNetCodes = new Map();
	for (const [DDNetCode, flagId] of DDNetCodeToFlagId.entries()) {
		if (!flagIdToDDNetCodes.has(flagId))
			flagIdToDDNetCodes.set(flagId, []);
		flagIdToDDNetCodes.get(flagId).push(DDNetCode);
	}

	for (const DDNetCodes of flagIdToDDNetCodes.values())
		DDNetCodes.sort();

	return flagIdToDDNetCodes;
}

function DDNetCodeToCommunityCode(DDNetCode, alpha2ToAlpha3) {
	if (!DDNetCode)
		return undefined;
	if (DDNetCode === "EU")
		return "EUR";
	if (/^[A-Z]{2}$/.test(DDNetCode))
		return alpha2ToAlpha3.get(DDNetCode) ?? DDNetCode;
	return DDNetCode;
}

function recommendCodeForFlagId(flagId, flagIdToDDNetCodes, alpha2ToAlpha3) {
	const DDNetCodes = flagIdToDDNetCodes.get(flagId);
	if (!DDNetCodes || DDNetCodes.length === 0)
		return undefined;

	for (const DDNetCode of DDNetCodes) {
		const communityCode = DDNetCodeToCommunityCode(DDNetCode, alpha2ToAlpha3);
		if (communityCode)
			return communityCode;
	}

	return DDNetCodes[0];
}

// Get master data
const [DDNetIndex, isoCSV, masterInfo] = await Promise.all([
	fetch(DDNET_INDEX_URL).then(async response => {
		if (!response.ok)
			throw new Error(`Could not fetch DDNet country index: HTTP ${response.status}`);
		return response.text();
	}),
	fetch(ISO_3166_CSV_URL).then(async response => {
		if (!response.ok)
			throw new Error(`Could not fetch ISO CSV: HTTP ${response.status}`);
		return response.text();
	}),
	fetch("https://info.ddnet.org/info").then(async response => {
		if (!response.ok)
			throw new Error(`Could not fetch DDNet info: HTTP ${response.status}`);
		return response.json();
	}),
]);

const DDNetCodeToFlagId = parseDDNetIndex(DDNetIndex);
const { alpha2ToAlpha3, alpha3ToAlpha2 } = parseIsoCodeMaps(isoCSV);
const flagIdToDDNetCodes = buildFlagIdToDDNetCodes(DDNetCodeToFlagId);

// Returns an error message if the region name/flagId mapping is invalid, undefined if valid
function checkFlagRegion(communityID, name, flagId) {
	const code = String(name ?? "").toUpperCase();
	const flagIdNum = Number(flagId);
	const knownFlagId = flagIdToDDNetCodes.has(flagIdNum);
	const DDNetCode = resolveDDNetCode(code, alpha3ToAlpha2, DDNetCodeToFlagId);
	const expectedFlagId = DDNetCode ? DDNetCodeToFlagId.get(DDNetCode) : undefined;

	if (expectedFlagId === undefined) {
		if (knownFlagId) {
			const recommendedCode = recommendCodeForFlagId(flagIdNum, flagIdToDDNetCodes, alpha2ToAlpha3) ?? "<unknown>";
			return `Unknown server country/region code: ${communityID}/${name}. Use code ${recommendedCode} for flagId ${flagIdNum}`;
		}
		return `Unknown server country/region code: ${communityID}/${name}`;
	}

	if (flagIdNum !== expectedFlagId) {
		if (!knownFlagId) {
			return `Invalid flag mapping for ${communityID}/${name}: got ${flagIdNum}, expected ${expectedFlagId} (DDNet code ${DDNetCode}). Use flagId ${expectedFlagId}`;
		}
		const recommendedCode = recommendCodeForFlagId(flagIdNum, flagIdToDDNetCodes, alpha2ToAlpha3) ?? "<unknown>";
		return `Invalid flag mapping for ${communityID}/${name}: got ${flagIdNum}, expected ${expectedFlagId} (DDNet code ${DDNetCode}). Use flagId ${flagIdNum} for code ${recommendedCode}`;
	}

	return undefined;
}

async function getServerData() {
	for (const {id: ID, name, icon: { servers }} of masterInfo.communities) {
		if (ID.toLowerCase() !== ID)
			console.warn(`Non lower case ID in master: ${ID}`);
		if (!IsIDUnique(ID))
			console.warn(`Non unqiue ID in master: ${ID}`);
		if (!IsNameUnique(name))
			console.warn(`Non unqiue name in master: ${name}`);
		if (!servers)
			continue;
		for (const server of servers) {
			for (const [gamemode, IPs] of Object.entries(server.servers)) {
				gamemodes.add(gamemode);
				for (const IP of IPs) {
					if (!IsIPUnique(IP))
						console.warn(`Non unique IP in master: ${IP}`);
				}
			}
		}
	}
}
await getServerData();

async function iconsToLowerCase() {
	for (const file of await fs.readdir("icons")) {
		const lower = file.toLowerCase();
		if (file !== lower) {
			const oldPath = path.join("icons", file);
			const newPath = path.join("icons", lower);
			await CIErrorFixable(`Warn icon not lower case: ${oldPath}`, async () => await fs.rename(oldPath, newPath));
		}
	}
}
await iconsToLowerCase();

// Load data files
const dataFiles = [];
for (const file of (await fs.readdir("data")).filter(file => file.endsWith(".json")).sort()) {
	const filePath = path.join("data", file);
	const raw = await fs.readFile(filePath, "utf8");
	let data;
	try {
		data = JSON.parse(raw);
	} catch (e) {
		CIError(`Invalid JSON: ${filePath}: ${e.message}`);
		continue;
	}
	dataFiles.push({ filePath, raw, data });
}

// Format
for (const entry of dataFiles) {
	const formatted = JSON.stringify(entry.data, undefined, "\t") + "\n";
	if (entry.raw !== formatted) {
		await CIErrorFixable(`JSON not formatted as standard JSON: ${entry.filePath}`, async () => {
			await fs.writeFile(entry.filePath, formatted);
		});
		entry.raw = formatted;
	}
}

function hasControlCharacters(text) {
	for (const character of text) {
		const code = character.codePointAt(0);
		if (code <= 0x1F || (code >= 0x7F && code <= 0x9F))
			return true;
	}
	return false;
}

function isValidIPv4(address) {
	const octets = address.split(".");
	if (octets.length !== 4)
		return false;
	return octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function isValidServerAddress(address) {
	const portSplit = address.lastIndexOf(":");
	if (portSplit === -1)
		return false;
	const host = address.slice(0, portSplit);
	const port = Number(address.slice(portSplit + 1));
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		return false;
	if (host.startsWith("[") && host.endsWith("]")) // IPv6
		return host.length > 2;
	return isValidIPv4(host);
}

async function verifyLocalData() {
	for (const { filePath, data: community } of dataFiles) {
		const { name, contactUrls, regions } = community;
		// The id is the filename, data/away.json -> away
		const ID = path.basename(filePath, ".json");
		if (!/^[a-z]+$/.test(ID))
			CIError(`ID (filename) must only contain lower case letters a-z: ${filePath}`);
		if (!IsIDUnique(ID))
			CIError(`Non unqiue ID: ${ID}`);
		if ("id" in community)
			await CIErrorFixable(`id must not be in data file, the id is the filename: ${filePath}`, () => delete community.id);
		if (typeof name !== "string" || name.length === 0) {
			CIError(`Missing name: ${ID}`);
		} else {
			if (hasControlCharacters(name))
				CIError(`Name contains control characters: ${ID} ${JSON.stringify(name)}`);
			if (!IsNameUnique(name))
				CIError(`Non unqiue name: ${name}`);
		}
		if (!Array.isArray(contactUrls) || contactUrls.length === 0) {
			CIError(`Missing contactUrls: ${ID}`);
		} else {
			for (const contactURL of contactUrls) {
				try {
					new URL(contactURL);
				} catch (e) {
					CIError(`Invalid URL: ${contactURL}`);
				}
			}
		}
		if (!Array.isArray(regions) || regions.length === 0) {
			CIError(`Empty regions: ${ID}`);
		} else {
			for (const [index, region] of regions.entries()) {
				const label = `${ID}/${region?.name ?? index}`;
				if (typeof region?.name !== "string" || region.name.length === 0)
					CIError(`Region name must be a non-empty string: ${label}`);
				if (!Number.isInteger(region?.flagId) || region.flagId < -999 || region.flagId > 999)
					CIError(`Region flagId must be an integer between -999 and 999: ${label} ${region?.flagId}`);
				const flagError = checkFlagRegion(ID, region?.name, region?.flagId);
				if (flagError)
					CIError(flagError);
				const servers = region?.servers;
				if (typeof servers !== "object" || servers === null || Array.isArray(servers) || Object.keys(servers).length === 0) {
					CIError(`Empty servers: ${label}`);
					continue;
				}
				for (const [gamemode, IPs] of Object.entries(servers)) {
					if (!Array.isArray(IPs) || IPs.length === 0) {
						CIError(`Empty servers list: ${label} ${gamemode}`);
						continue;
					}
					gamemodes.add(gamemode);
					for (const IP of IPs) {
						if (typeof IP !== "string" || !isValidServerAddress(IP))
							CIError(`Invalid ip:port: ${label} ${gamemode} ${JSON.stringify(IP)}`);
						else if (!IsIPUnique(IP))
							CIError(`Non unique IP: ${IP}`);
					}
				}
			}
		}
		// Extra verification for local
		const iconPath = `./icons/${ID}.png`;
		if (!await exists(iconPath)) {
			CIError(`Missing icon: ${iconPath}`);
		}
	}
}
await verifyLocalData();

if (!noEdit) {
	for (const { filePath, raw, data } of dataFiles) {
		const formatted = JSON.stringify(data, undefined, "\t") + "\n";
		if (raw !== formatted) {
			console.log(`Edited JSON: ${filePath}`);
			await fs.writeFile(filePath, formatted);
		}
	}
}

if (CIFailed) {
	console.error("Failed!");
	process.exit(1);
}
