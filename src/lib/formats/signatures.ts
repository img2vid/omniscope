import { parseHexPattern } from "@/lib/utils";

export interface Signature {
  /** hex bytes, "?? " wildcards, e.g. "52 49 46 46 ?? ?? ?? ?? 57 45 42 50" */
  pattern: string;
  offset: number;
  name: string;
  /** format key to route to when matched */
  key: string;
  desc?: string;
}

/**
 * Curated high-value binary signatures (byte offsets included).
 * Additional signatures live inside format records in the database files.
 */
export const SIGNATURES: Signature[] = [
  // ---------- images ----------
  { pattern: "89 50 4E 47 0D 0A 1A 0A", offset: 0, name: "PNG image", key: "png" },
  { pattern: "FF D8 FF", offset: 0, name: "JPEG image", key: "jpg" },
  { pattern: "47 49 46 38 37 61", offset: 0, name: "GIF (87a)", key: "gif" },
  { pattern: "47 49 46 38 39 61", offset: 0, name: "GIF (89a)", key: "gif" },
  { pattern: "42 4D", offset: 0, name: "BMP bitmap", key: "bmp" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 57 45 42 50", offset: 0, name: "WebP image", key: "webp" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 41 43 4F 4E", offset: 0, name: "RIFF Windows animated cursor", key: "ani" },
  { pattern: "00 00 01 00", offset: 0, name: "ICO icon", key: "ico" },
  { pattern: "00 00 02 00", offset: 0, name: "CUR cursor", key: "cur" },
  { pattern: "49 49 2A 00", offset: 0, name: "TIFF (little endian)", key: "tiff" },
  { pattern: "4D 4D 00 2A", offset: 0, name: "TIFF (big endian)", key: "tiff" },
  { pattern: "66 74 79 70 61 76 69 66", offset: 4, name: "AVIF image", key: "avif" },
  { pattern: "66 74 79 70 68 65 69 63", offset: 4, name: "HEIC image", key: "heic" },
  { pattern: "66 74 79 70 68 65 69 78", offset: 4, name: "HEIF image", key: "heif" },
  { pattern: "66 74 79 70 6D 69 66 31", offset: 4, name: "HEIF (multi-image)", key: "heif" },
  { pattern: "38 42 50 53", offset: 0, name: "Photoshop PSD", key: "psd" },
  { pattern: "00 00 00 0C 6A 50 20 20 0D 0A 87 0A", offset: 0, name: "JPEG 2000 (JP2)", key: "jp2" },
  { pattern: "FF 4F FF 51", offset: 0, name: "JPEG 2000 codestream", key: "j2c" },
  // RIFF family
  { pattern: "52 49 46 46 ?? ?? ?? ?? 57 41 56 45", offset: 0, name: "WAVE audio", key: "wav" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 41 56 49 20", offset: 0, name: "AVI video", key: "avi" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 41 49 46 46", offset: 0, name: "AIFF audio", key: "aiff" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 41 49 46 43", offset: 0, name: "AIFF-C audio", key: "aifc" },
  { pattern: "52 49 46 46", offset: 0, name: "RIFF container", key: "riff" },
  // ---------- documents ----------
  { pattern: "25 50 44 46 2D", offset: 0, name: "PDF document", key: "pdf" },
  { pattern: "25 21 50 53", offset: 0, name: "PostScript", key: "ps" },
  { pattern: "D0 CF 11 E0 A1 B1 1A E1", offset: 0, name: "Compound File Binary (DOC/XLS/PPT/MSI)", key: "cfb" },
  { pattern: "7B 5C 72 74 66 31", offset: 0, name: "Rich Text Format", key: "rtf" },
  // ---------- audio / video ----------
  { pattern: "49 44 33", offset: 0, name: "MP3 (ID3v2 tag)", key: "mp3" },
  { pattern: "FF FB", offset: 0, name: "MP3 audio", key: "mp3" },
  { pattern: "FF F3", offset: 0, name: "MP3 audio", key: "mp3" },
  { pattern: "FF F2", offset: 0, name: "MP3 audio", key: "mp3" },
  { pattern: "FF F1", offset: 0, name: "AAC audio (ADTS)", key: "aac" },
  { pattern: "FF F9", offset: 0, name: "AAC audio (ADTS)", key: "aac" },
  { pattern: "66 4C 61 43", offset: 0, name: "FLAC audio", key: "flac" },
  { pattern: "4F 67 67 53", offset: 0, name: "Ogg container", key: "ogg" },
  { pattern: "1A 45 DF A3", offset: 0, name: "Matroska / WebM", key: "mkv" },
  { pattern: "30 26 B2 75 8E 66 CF 11", offset: 0, name: "ASF / WMV / WMA", key: "wma" },
  { pattern: "66 74 79 70 69 73 6F 6D", offset: 4, name: "MP4 video (isom)", key: "mp4" },
  { pattern: "66 74 79 70 6D 70 34 32", offset: 4, name: "MP4 video (mp42)", key: "mp4" },
  { pattern: "66 74 79 70 71 74 20 20", offset: 4, name: "QuickTime movie", key: "mov" },
  { pattern: "66 74 79 70 33 67 70", offset: 4, name: "3GPP video", key: "3gp" },
  { pattern: "66 74 79 70 4D 34 41 20", offset: 4, name: "M4A audio", key: "m4a" },
  { pattern: "4D 54 68 64", offset: 0, name: "MIDI music", key: "mid" },
  { pattern: "4D 41 43 20 96 0F 00 00 34 00 00 00 18 00 00 00", offset: 0, name: "Monkey's Audio (APE)", key: "ape" },
  { pattern: "54 54 41 31", offset: 0, name: "TTA lossless audio", key: "tta" },
  { pattern: "77 76 70 6B", offset: 0, name: "WavPack audio", key: "wv" },
  { pattern: "66 74 79 70 64 61 73 68", offset: 4, name: "MPEG-DASH manifest", key: "mpd" },
  // ---------- misc formats ----------
  { pattern: "64 34 3A 69 6E 66 6F", offset: 0, name: "BitTorrent metainfo", key: "torrent" },
  { pattern: "30 82", offset: 0, name: "DER certificate", key: "der" },
  // ---------- archives ----------
  { pattern: "50 4B 03 04", offset: 0, name: "ZIP archive", key: "zip" },
  { pattern: "50 4B 05 06", offset: 0, name: "ZIP (empty)", key: "zip" },
  { pattern: "50 4B 07 08", offset: 0, name: "ZIP spanned marker", key: "zip" },
  { pattern: "1F 8B 08", offset: 0, name: "GZIP stream", key: "gz" },
  { pattern: "42 5A 68", offset: 0, name: "BZIP2 archive", key: "bz2" },
  { pattern: "FD 37 7A 58 5A 00", offset: 0, name: "XZ archive", key: "xz" },
  { pattern: "28 B5 2F FD", offset: 0, name: "Zstandard archive", key: "zst" },
  { pattern: "04 22 4D 18", offset: 0, name: "LZ4 frame", key: "lz4" },
  { pattern: "37 7B BC AF 27 1C", offset: 0, name: "7-Zip archive", key: "7z" },
  { pattern: "52 61 72 21 1A 07 00", offset: 0, name: "RAR (v4)", key: "rar" },
  { pattern: "52 61 72 21 1A 07 01 00", offset: 0, name: "RAR (v5)", key: "rar" },
  { pattern: "4D 53 43 46", offset: 0, name: "Microsoft CAB", key: "cab" },
  { pattern: "43 44 30 30 31", offset: 32769, name: "ISO 9660 image", key: "iso" },
  { pattern: "75 73 74 61 72", offset: 257, name: "TAR (POSIX)", key: "tar" },
  { pattern: "21 3C 61 72 63 68 3E 0A 64 65 62 69 61 6E", offset: 0, name: "Debian package", key: "deb" },
  { pattern: "ED AB EE DB", offset: 0, name: "RPM package", key: "rpm" },
  { pattern: "78 61 72 21", offset: 0, name: "XAR archive", key: "xar" },
  { pattern: "4C 5A 49 50", offset: 0, name: "LZIP", key: "lz" },
  { pattern: "30 37 30 37 30 31", offset: 0, name: "CPIO (new ASCII)", key: "cpio" },
  { pattern: "C7 71", offset: 0, name: "CPIO (binary)", key: "cpio" },
  { pattern: "21 3C 61 72 63 68 3E", offset: 0, name: "Unix ar archive", key: "ar" },
  // ---------- fonts ----------
  { pattern: "77 4F 46 46", offset: 0, name: "WOFF font", key: "woff" },
  { pattern: "77 4F 46 32", offset: 0, name: "WOFF2 font", key: "woff2" },
  { pattern: "4F 54 54 4F", offset: 0, name: "OpenType (CFF)", key: "otf" },
  { pattern: "74 74 63 66", offset: 0, name: "TrueType collection", key: "ttc" },
  { pattern: "53 54 41 52 54 46 4F 4E 54", offset: 0, name: "BDF font", key: "bdf" },
  // ---------- system / binaries ----------
  { pattern: "7F 45 4C 46", offset: 0, name: "ELF executable", key: "elf" },
  { pattern: "FE ED FA CE", offset: 0, name: "Mach-O (32-bit BE)", key: "macho" },
  { pattern: "FE ED FA CF", offset: 0, name: "Mach-O (64-bit BE)", key: "macho" },
  { pattern: "CE FA ED FE", offset: 0, name: "Mach-O (32-bit LE)", key: "macho" },
  { pattern: "CF FA ED FE", offset: 0, name: "Mach-O (64-bit LE)", key: "macho" },
  { pattern: "4D 5A", offset: 0, name: "DOS/Windows executable", key: "exe" },
  { pattern: "00 61 73 6D", offset: 0, name: "WebAssembly binary", key: "wasm" },
  { pattern: "46 57 53", offset: 0, name: "SWF (uncompressed)", key: "swf" },
  { pattern: "43 57 53", offset: 0, name: "SWF (compressed)", key: "swf" },
  { pattern: "46 4C 56", offset: 0, name: "Flash video", key: "flv" },
  { pattern: "4D 44 4D 50", offset: 0, name: "Windows minidump", key: "dmp" },
  { pattern: "50 41 47 45 44 55 36 34", offset: 0, name: "Kernel dump", key: "dmp" },
  { pattern: "72 65 67 66", offset: 0, name: "Windows registry hive", key: "hiv" },
  { pattern: "45 46 49 20 50 41 52 54", offset: 512, name: "GPT disk", key: "gpt" },
  { pattern: "68 73 71 73", offset: 0, name: "SquashFS", key: "squashfs" },
  { pattern: "4C 55 4B 53 BA BE", offset: 0, name: "LUKS encrypted volume", key: "luks" },
  { pattern: "51 46 49 FB", offset: 0, name: "QEMU QCOW2 image", key: "qcow2" },
  { pattern: "4B 44 4D 56", offset: 0, name: "VMware VMDK", key: "vmdk" },
  { pattern: "63 6F 6E 65 63 74 69 78", offset: 0, name: "VHD (fixed)", key: "vhd" },
  { pattern: "76 68 64 78 66 69 6C 65", offset: 0, name: "VHDX image", key: "vhdx" },
  { pattern: "4D 53 57 49 4D 20 20 00", offset: 0, name: "Windows Imaging format", key: "wim" },
  { pattern: "89 48 44 46", offset: 0, name: "HDF5 dataset", key: "h5" },
  { pattern: "43 44 46 01", offset: 0, name: "NetCDF classic", key: "nc" },
  { pattern: "43 44 46 02", offset: 0, name: "NetCDF 64-bit offset", key: "nc" },
  { pattern: "53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00", offset: 0, name: "SQLite database", key: "sqlite" },
  { pattern: "D4 C3 B2 A1", offset: 0, name: "pcap (LE)", key: "pcap" },
  { pattern: "A1 B2 C3 D4", offset: 0, name: "pcap (BE)", key: "pcap" },
  { pattern: "0A 0D 0D 0A", offset: 0, name: "pcapng", key: "pcapng" },
  // ---------- 3D / CAD / game ----------
  { pattern: "67 6C 54 46", offset: 4, name: "glTF binary", key: "glb" },
  { pattern: "4D 44 4C 58", offset: 0, name: "Warcraft III model", key: "mdx" },
  { pattern: "49 44 50 32", offset: 0, name: "Quake MD2", key: "md2" },
  { pattern: "49 44 50 33", offset: 0, name: "Quake MD3", key: "md3" },
  { pattern: "4D 50 51 1A", offset: 0, name: "Blizzard MPQ", key: "mpq" },
  { pattern: "49 57 41 44", offset: 0, name: "DOOM IWAD", key: "iwad" },
  { pattern: "50 57 41 44", offset: 0, name: "DOOM PWAD", key: "pwad" },
  { pattern: "56 42 53 50", offset: 0, name: "Quake BSP", key: "bsp" },
  { pattern: "42 4C 45 4E 44 45 52", offset: 0, name: "Blender scene", key: "blend" },
  { pattern: "4B 61 79 64 61 72 61 20 46 42 58", offset: 0, name: "FBX binary", key: "fbx" },
  { pattern: "41 43 31 30", offset: 0, name: "AutoCAD DWG", key: "dwg" },
  { pattern: "70 6C 79 0A", offset: 0, name: "PLY model", key: "ply" },
  { pattern: "4E 45 53 4D 1A", offset: 0, name: "NES ROM", key: "nes" },
  { pattern: "CE ED 66 66 CC 0D 00 0B", offset: 308, name: "Game Boy ROM", key: "gb" },
  { pattern: "80 37 12 40", offset: 0, name: "N64 ROM (Z64)", key: "n64" },
  { pattern: "37 80 40 12", offset: 0, name: "N64 ROM (V64)", key: "v64" },
  { pattern: "50 41 54 43 48", offset: 0, name: "IPS patch", key: "ips" },
  { pattern: "1B 4C 75 61", offset: 0, name: "Lua bytecode", key: "luac" },
  { pattern: "4D 4B 2E", offset: 0, name: "Amiga MOD", key: "mod" },
  { pattern: "45 78 74 65 6E 64 65 64 20 4D 6F 64 75 6C 65", offset: 0, name: "FastTracker XM", key: "xm" },
  { pattern: "49 4D 50 4D", offset: 0, name: "Impulse Tracker IT", key: "it" },
  { pattern: "53 43 52 4D", offset: 44, name: "Scream Tracker S3M", key: "s3m" },
  { pattern: "4E 45 53 4D", offset: 0, name: "NES Sound Format", key: "nsf" },
  { pattern: "50 53 49 44", offset: 0, name: "Commodore SID", key: "sid" },
  // ---------- text prefixes ----------
  { pattern: "3C 3F 78 6D 6C", offset: 0, name: "XML document", key: "xml" },
  { pattern: "3C 73 76 67", offset: 0, name: "SVG image", key: "svg" },
  { pattern: "23 56 52 4D 4C 20 56 32 2E 30", offset: 0, name: "VRML world", key: "wrl" },

  // ---------- ISO BMFF ftyp brands (distinct recognized brands) ----------
  { pattern: "66 74 79 70 69 73 6F 32", offset: 4, name: "MP4 (iso2)", key: "mp4" },
  { pattern: "66 74 79 70 69 73 6F 33", offset: 4, name: "MP4 (iso3)", key: "mp4" },
  { pattern: "66 74 79 70 69 73 6F 34", offset: 4, name: "MP4 (iso4)", key: "mp4" },
  { pattern: "66 74 79 70 69 73 6F 35", offset: 4, name: "MP4 (iso5)", key: "mp4" },
  { pattern: "66 74 79 70 6D 70 34 31", offset: 4, name: "MP4 (mp41)", key: "mp4" },
  { pattern: "66 74 79 70 61 76 63 31", offset: 4, name: "MP4 (avc1)", key: "mp4" },
  { pattern: "66 74 79 70 61 76 63 33", offset: 4, name: "MP4 (avc3)", key: "mp4" },
  { pattern: "66 74 79 70 68 65 76 31", offset: 4, name: "MP4 (hev1 HEVC)", key: "mp4" },
  { pattern: "66 74 79 70 68 76 63 31", offset: 4, name: "MP4 (hvc1 HEVC)", key: "mp4" },
  { pattern: "66 74 79 70 61 76 30 31", offset: 4, name: "MP4 (av01 AV1)", key: "mp4" },
  { pattern: "66 74 79 70 64 61 73 68", offset: 4, name: "DASH segment", key: "mp4" },
  { pattern: "66 74 79 70 6D 6D 70 34", offset: 4, name: "MPEG-4 multi-platform", key: "mp4" },
  { pattern: "66 74 79 70 6D 73 69 78", offset: 4, name: "MSIX package", key: "mp4" },
  { pattern: "66 74 79 70 6D 70 36 34", offset: 4, name: "MP4 v64", key: "mp4" },
  { pattern: "66 74 79 70 66 34 76 20", offset: 4, name: "Flash F4V", key: "f4v" },
  { pattern: "66 74 79 70 66 34 70 20", offset: 4, name: "Flash F4P", key: "f4v" },
  { pattern: "66 74 79 70 66 34 61 20", offset: 4, name: "Flash F4A", key: "m4a" },
  { pattern: "66 74 79 70 66 34 62 20", offset: 4, name: "Flash F4B", key: "m4a" },
  { pattern: "66 74 79 70 4D 34 56 20", offset: 4, name: "M4V video", key: "mp4" },
  { pattern: "66 74 79 70 4D 34 50 20", offset: 4, name: "M4P protected", key: "m4a" },
  { pattern: "66 74 79 70 4D 34 42 20", offset: 4, name: "M4B audiobook", key: "m4a" },
  { pattern: "66 74 79 70 33 67 70 34", offset: 4, name: "3GP (3gp4)", key: "3gp" },
  { pattern: "66 74 79 70 33 67 70 35", offset: 4, name: "3GP (3gp5)", key: "3gp" },
  { pattern: "66 74 79 70 33 67 32 61", offset: 4, name: "3G2 (3g2a)", key: "3gp" },
  { pattern: "66 74 79 70 33 67 32 62", offset: 4, name: "3G2 (3g2b)", key: "3gp" },
  { pattern: "66 74 79 70 33 67 32 63", offset: 4, name: "3G2 (3g2c)", key: "3gp" },
  { pattern: "66 74 79 70 6E 64 73 63", offset: 4, name: "Nero Digital video", key: "mp4" },
  { pattern: "66 74 79 70 6E 64 73 68", offset: 4, name: "Nero Digital HD", key: "mp4" },
  { pattern: "66 74 79 70 6E 64 73 6D", offset: 4, name: "Nero mobile video", key: "mp4" },
  { pattern: "66 74 79 70 6E 64 73 70", offset: 4, name: "Nero mobile HD", key: "mp4" },
  { pattern: "66 74 79 70 6E 64 73 73", offset: 4, name: "Nero subtitle", key: "mp4" },
  { pattern: "66 74 79 70 6E 64 78 68", offset: 4, name: "Nero HD audio", key: "mp4" },
  { pattern: "66 74 79 70 6E 64 78 69", offset: 4, name: "Nero audio", key: "m4a" },
  { pattern: "66 74 79 70 6E 64 78 6D", offset: 4, name: "Nero mobile audio", key: "m4a" },
  { pattern: "66 74 79 70 6E 64 78 70", offset: 4, name: "Nero audio pro", key: "m4a" },
  { pattern: "66 74 79 70 6E 64 78 73", offset: 4, name: "Nero subtitle audio", key: "m4a" },
  { pattern: "66 74 79 70 71 74 20 20", offset: 4, name: "QuickTime (qt)", key: "mov" },
  // more real registered brands
  { pattern: "66 74 79 70 69 73 6F 36", offset: 4, name: "MP4 (iso6)", key: "mp4" },
  { pattern: "66 74 79 70 69 73 6F 37", offset: 4, name: "MP4 (iso7)", key: "mp4" },
  { pattern: "66 74 79 70 69 73 6F 38", offset: 4, name: "MP4 (iso8)", key: "mp4" },
  { pattern: "66 74 79 70 69 73 6F 39", offset: 4, name: "MP4 (iso9)", key: "mp4" },
  { pattern: "66 74 79 70 69 73 6D 6C", offset: 4, name: "Smooth Streaming manifest", key: "mp4" },
  { pattern: "66 74 79 70 6D 69 61 66", offset: 4, name: "MIAF image", key: "heif" },
  { pattern: "66 74 79 70 6D 69 66 32", offset: 4, name: "HEIF (mif2)", key: "heif" },
  { pattern: "66 74 79 70 6D 73 66 31", offset: 4, name: "HEIF (msf1 sequence)", key: "heif" },
  { pattern: "66 74 79 70 6D 70 37 31", offset: 4, name: "MPEG-7 (mp71)", key: "mp4" },
  { pattern: "66 74 79 70 6D 70 37 32", offset: 4, name: "MPEG-7 (mp72)", key: "mp4" },
  { pattern: "66 74 79 70 6F 64 63 66", offset: 4, name: "OMA DRM (odcf)", key: "mp4" },
  { pattern: "66 74 79 70 6F 64 74 6D", offset: 4, name: "OMA DRM v2 (odtm)", key: "mp4" },
  { pattern: "66 74 79 70 70 69 66 66", offset: 4, name: "PIFF protected media", key: "mp4" },
  { pattern: "66 74 79 70 73 73 63 31", offset: 4, name: "Samsung (ssc1)", key: "mp4" },
  { pattern: "66 74 79 70 73 73 63 32", offset: 4, name: "Samsung (ssc2)", key: "mp4" },
  { pattern: "66 74 79 70 64 62 79 31", offset: 4, name: "Dolby (dby1)", key: "mp4" },
  { pattern: "66 74 79 70 62 64 6D 76", offset: 4, name: "Blu-ray (bdmv)", key: "mp4" },
  { pattern: "66 74 79 70 62 72 61 77", offset: 4, name: "Blackmagic RAW", key: "mp4" },
  { pattern: "66 74 79 70 61 6C 73 74", offset: 4, name: "AirLive stream", key: "mp4" },
  { pattern: "66 74 79 70 6A 78 73 69", offset: 4, name: "JPEG XS (jxsi)", key: "mp4" },
  { pattern: "66 74 79 70 6A 78 73 73", offset: 4, name: "JPEG XS (jxss)", key: "mp4" },
  { pattern: "66 74 79 70 6A 78 73 62", offset: 4, name: "JPEG XS (jxsb)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 75", offset: 4, name: "DECE UltraViolet (uvvu)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 64", offset: 4, name: "DECE UltraViolet (uvvd)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 6D", offset: 4, name: "DECE UltraViolet (uvvm)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 70", offset: 4, name: "DECE UltraViolet (uvvp)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 73", offset: 4, name: "DECE UltraViolet (uvvs)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 74", offset: 4, name: "DECE UltraViolet (uvvt)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 78", offset: 4, name: "DECE UltraViolet (uvvx)", key: "mp4" },
  { pattern: "66 74 79 70 75 76 76 7A", offset: 4, name: "DECE UltraViolet (uvvz)", key: "mp4" },
  { pattern: "66 74 79 70 6C 69 71 69", offset: 4, name: "Liquid Audio", key: "mp4" },
  { pattern: "66 74 79 70 61 76 69 73", offset: 4, name: "AVIS (dvr)", key: "mp4" },
  { pattern: "66 74 79 70 63 61 71 76", offset: 4, name: "Casio (caqv)", key: "mp4" },
  { pattern: "66 74 79 70 63 68 64 31", offset: 4, name: "Roxio (chd1)", key: "mp4" },
  { pattern: "66 74 79 70 63 68 64 32", offset: 4, name: "Roxio (chd2)", key: "mp4" },
  { pattern: "66 74 79 70 64 61 30 61", offset: 4, name: "DMP4 (da0a)", key: "mp4" },
  { pattern: "66 74 79 70 64 61 30 62", offset: 4, name: "DMP4 (da0b)", key: "mp4" },
  { pattern: "66 74 79 70 64 61 30 63", offset: 4, name: "DMP4 (da0c)", key: "mp4" },
  { pattern: "66 74 79 70 64 61 30 64", offset: 4, name: "DMP4 (da0d)", key: "mp4" },
  { pattern: "66 74 79 70 64 61 30 65", offset: 4, name: "DMP4 (da0e)", key: "mp4" },
  { pattern: "66 74 79 70 64 61 30 66", offset: 4, name: "DMP4 (da0f)", key: "mp4" },
  { pattern: "66 74 79 70 74 71 68 76", offset: 4, name: "TQHY video", key: "mp4" },
  { pattern: "66 74 79 70 74 71 68 6C", offset: 4, name: "TQHL stream", key: "mp4" },
  { pattern: "66 74 79 70 6B 64 64 69", offset: 4, name: "KDDI video", key: "3gp" },
  { pattern: "66 74 79 70 6B 64 64 62", offset: 4, name: "KDDI audio", key: "3gp" },
  { pattern: "66 74 79 70 6B 64 64 63", offset: 4, name: "KDDI song", key: "3gp" },
  { pattern: "66 74 79 70 6D 73 6E 76", offset: 4, name: "Portable video", key: "mp4" },

  // ---------- RIFF forms / IFF forms ----------
  { pattern: "52 49 46 46 ?? ?? ?? ?? 52 4D 49 44", offset: 0, name: "RIFF MIDI", key: "rmi" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 52 44 49 42", offset: 0, name: "RIFF DIB", key: "dib" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 50 41 4C 20", offset: 0, name: "RIFF Palette", key: "pal" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 57 41 56 4C", offset: 0, name: "WAV 64-bit", key: "wav" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 38 53 56 58", offset: 0, name: "Amiga 8SVX audio", key: "iff" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 49 4C 42 4D", offset: 0, name: "IFF ILBM bitmap", key: "iff" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 4D 41 59 41", offset: 0, name: "Maya IFF image", key: "iff" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 4C 57 4F 42", offset: 0, name: "LightWave LWOB", key: "lwo" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 4C 57 4F 32", offset: 0, name: "LightWave LWO2", key: "lwo" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 46 58 53 52", offset: 0, name: "Amiga FastRAM", key: "iff" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 4D 41 55 44", offset: 0, name: "Amiga MAUD audio", key: "iff" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 38 58 50 4E", offset: 0, name: "Amiga 8XPNe", key: "iff" },
  { pattern: "46 4F 52 4D ?? ?? ?? ?? 44 53 50 54", offset: 0, name: "Deluxe Paint anim", key: "iff" },

  // ---------- system / filesystems / disks ----------
  { pattern: "55 AA", offset: 510, name: "Master Boot Record", key: "mbr" },
  { pattern: "53 EF", offset: 1080, name: "ext2/3/4 superblock", key: "img" },
  { pattern: "45 3D CD 28", offset: 0, name: "CramFS image", key: "cramfs" },
  { pattern: "19 85", offset: 0, name: "JFFS2 image", key: "jffs2" },
  { pattern: "06 0E 2B 34", offset: 0, name: "SMPTE MXF/AIC", key: "mxf" },
  { pattern: "42 45 41 30 31", offset: 32769, name: "UDF bridge volume", key: "udf" },
  { pattern: "4E 53 52 30 33", offset: 32769, name: "UDF 2.60 volume", key: "udf" },
  { pattern: "49 54 53 46", offset: 0, name: "Compiled HTML Help", key: "chm" },
  { pattern: "4B 44 4D", offset: 0, name: "Valve demo", key: "dem" },
  { pattern: "4C 45 47 4F ?? ?? 4C 47 31 2E 30", offset: 0, name: "LEGO Digital Designer", key: "lxfml" },

  // ---------- compression ----------
  { pattern: "1F 9D", offset: 0, name: "compress'd (LZW)", key: "z" },
  { pattern: "60 EA", offset: 0, name: "ARJ archive", key: "arj" },
  { pattern: "5A 4F 4F 20", offset: 0, name: "ZOO archive", key: "zoo" },
  { pattern: "4D 53 46 44", offset: 0, name: "MS-DOS Superfloppy", key: "img" },  // ---------- more real engine/console magics ----------
  { pattern: "53 74 75 66 66 49 74", offset: 0, name: "StuffIt archive", key: "sit" },
  { pattern: "49 54 4F 4C 49 54 4C 53", offset: 0, name: "MS Reader eBook", key: "lit" },
  { pattern: "78 01", offset: 0, name: "zlib stream (level 1)", key: "zlib" },
  { pattern: "78 9C", offset: 0, name: "zlib stream (default)", key: "zlib" },
  { pattern: "78 DA", offset: 0, name: "zlib stream (best)", key: "zlib" },
  { pattern: "78 5E", offset: 0, name: "zlib stream (level 2)", key: "zlib" },
  { pattern: "50 41 43 4B", offset: 0, name: "Quake PAK", key: "pak" },
  { pattern: "57 41 44 32", offset: 0, name: "Quake WAD2", key: "wad2" },
  { pattern: "49 44 50 4F", offset: 0, name: "Quake MDL", key: "mdl" },
  { pattern: "49 44 53 50", offset: 0, name: "Quake sprite", key: "spr" },
  { pattern: "56 67 6D 20", offset: 0, name: "VGM log", key: "vgm" },
  { pattern: "47 59 4D 58", offset: 0, name: "GYM log", key: "gym" },
  { pattern: "47 42 53 1A", offset: 0, name: "Game Boy sound rip", key: "gbs" },
  { pattern: "54 54 41 31", offset: 0, name: "TrueAudio", key: "tta" },
  { pattern: "54 43 53 4F", offset: 2, name: "Flash shared object", key: "sol" },
  { pattern: "4E 41 52 43", offset: 0, name: "Nintendo NARC", key: "narc" },
  { pattern: "4E 43 47 52", offset: 0, name: "Nitro character graphics", key: "ncgr" },
  { pattern: "4E 43 4C 52", offset: 0, name: "Nitro color palette", key: "nclr" },
  { pattern: "4E 53 43 52", offset: 0, name: "Nitro screen data", key: "nscr" },
  { pattern: "4E 41 4E 52", offset: 0, name: "Nitro animation", key: "nanr" },
  { pattern: "62 72 65 73", offset: 0, name: "Wii BRRES", key: "brres" },
  { pattern: "55 AA 38 2D", offset: 0, name: "U8 archive", key: "u8" },
  { pattern: "59 61 7A 30", offset: 0, name: "Yaz0 compressed", key: "szs" },
  { pattern: "59 61 7A 31", offset: 0, name: "Yaz1 compressed", key: "szs" },
  { pattern: "52 41 52 43", offset: 0, name: "RARC archive", key: "rarc" },
  { pattern: "00 20 AF 30", offset: 0, name: "Wii TPL texture", key: "tpl" },
  { pattern: "4C 5A 37 37", offset: 0, name: "LZ77 (Nintendo)", key: "lz77" },
  { pattern: "2A 50 50 44 2D 41 64 6F 62 65", offset: 0, name: "PostScript PPD", key: "ppd" },
  { pattern: "53 74 61 72 74 46 6F 6E 74 4D 65 74 72 69 63 73", offset: 0, name: "Adobe font metrics", key: "afm" },
  { pattern: "52 49 46 46 ?? ?? ?? ?? 43 44 52", offset: 0, name: "CorelDRAW CDR", key: "cdr" },

];

interface CompiledSig extends Signature { bytes: (number | null)[]; }

const compiled: CompiledSig[] = [];
const byFirstByte = new Map<number, CompiledSig[]>();
const byOffset = new Map<number, CompiledSig[]>();

function compile() {
  if (compiled.length) return;
  for (const sig of SIGNATURES) {
    const bytes = parseHexPattern(sig.pattern);
    if (!bytes) continue;
    const c = { ...sig, bytes };
    compiled.push(c);
    if (sig.offset === 0) {
      const b0 = bytes[0];
      if (b0 !== null) {
        if (!byFirstByte.has(b0)) byFirstByte.set(b0, []);
        byFirstByte.get(b0)!.push(c);
      }
    } else {
      if (!byOffset.has(sig.offset)) byOffset.set(sig.offset, []);
      byOffset.get(sig.offset)!.push(c);
    }
  }
  for (const list of [...byFirstByte.values(), ...byOffset.values()]) {
    list.sort((a, b) => b.bytes.length - a.bytes.length);
  }
}

function matchAt(buf: Uint8Array, bytes: (number | null)[], base: number): boolean {
  const end = base + bytes.length;
  if (end > buf.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    const want = bytes[i];
    if (want !== null && buf[base + i] !== want) return false;
  }
  return true;
}

export interface SignatureMatch { sig: Signature; hex: string; }

/** Match signatures against the head of a file. Longest match first. */
export function matchSignatures(head: Uint8Array): SignatureMatch[] {
  compile();
  const hits: (SignatureMatch & { len: number })[] = [];
  const b0 = head[0];
  if (b0 !== undefined) {
    for (const sig of byFirstByte.get(b0) ?? []) {
      if (matchAt(head, sig.bytes, 0)) hits.push({ sig, hex: sig.pattern, len: sig.bytes.length });
    }
  }
  for (const [off, list] of byOffset) {
    for (const sig of list) {
      if (off < head.length && matchAt(head, sig.bytes, off)) {
        hits.push({ sig, hex: sig.pattern, len: sig.bytes.length });
      }
    }
  }
  // MZ + PE\0\0 at e_lfanew
  if (head[0] === 0x4d && head[1] === 0x5a && head.length > 0x40) {
    const peOff = head[0x3c] | (head[0x3d] << 8);
    if (peOff > 0 && peOff + 4 <= head.length &&
      head[peOff] === 0x50 && head[peOff + 1] === 0x45 && head[peOff + 2] === 0 && head[peOff + 3] === 0) {
      hits.push({ sig: { pattern: "4D 5A … 50 45 00 00", offset: 0, name: "Windows PE executable", key: "exe" }, hex: "4D 5A … 50 45 00 00", len: 8 });
    }
  }
  hits.sort((a, b) => b.len - a.len);
  const out: SignatureMatch[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const id = h.sig.key + "|" + h.sig.pattern;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ sig: h.sig, hex: h.hex });
  }
  return out;
}

export function matchRecordSignature(head: Uint8Array, sig: string, sigOffset = 0): boolean {
  const bytes = parseHexPattern(sig);
  if (!bytes) return false;
  return matchAt(head, bytes, sigOffset);
}
