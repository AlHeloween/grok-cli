import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { promisify } from 'util';
import { resolveGlovePath, getInstallationRoot } from '../utils/path-utils.js';
import { loadSqlite3Module } from '../rag/vector-db.js';
import chalk from 'chalk';

const exec = promisify(child_process.exec);

async function getGloveMetadata(dbPath: string): Promise<{ count: number; dimension: number }> {
  const sqlite3 = await loadSqlite3Module();
  // Read database file into memory
  const buf = fs.readFileSync(dbPath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  
  // Create in-memory database
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  
  // Deserialize the database
  const pData = sqlite3.wasm.allocFromTypedArray(bytes);
  const len = BigInt(bytes.byteLength);
  const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
  
  const rc = sqlite3.capi.sqlite3_deserialize(
    db.pointer,
    'main',
    pData,
    len,
    len,
    flags
  );
  
  if (rc !== sqlite3.capi.SQLITE_OK) {
    const rcStr = typeof sqlite3.capi.sqlite3_js_rc_str === 'function'
      ? sqlite3.capi.sqlite3_js_rc_str(rc)
      : String(rc);
    throw new Error(`Failed to deserialize SQLite DB: ${rcStr}`);
  }
  
  // Get metadata
  const count = db.selectValue('SELECT COUNT(*) FROM glove') as number;
  const dimension = db.selectValue('SELECT dimension FROM glove LIMIT 1') as number;
  
  db.close();
  return { count, dimension };
}

export function createGloveCommand(): Command {
  const gloveCommand = new Command('glove');
  gloveCommand.description('Manage GloVe word embedding databases');

  // Status subcommand
  gloveCommand
    .command('status')
    .description('Show current GloVe database status')
    .option('-d, --directory <dir>', 'working directory', process.cwd())
    .action(async (options) => {
      const cwd = options.directory;
      const dbPath = resolveGlovePath(cwd);
      
      if (!dbPath) {
        console.log(chalk.yellow('No GloVe database found.'));
        console.log(chalk.gray('Run `grok glove generate` or `grok glove download` to create one.'));
        return;
      }
      
      console.log(chalk.bold('GloVe Database Status'));
      console.log(`Path: ${dbPath}`);
      
      if (!fs.existsSync(dbPath)) {
        console.log(chalk.red('Database file does not exist.'));
        return;
      }
      
      const stats = fs.statSync(dbPath);
      console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Try to open database and get metadata
      try {
        const { count, dimension } = await getGloveMetadata(dbPath);
        console.log(`Words: ${count}`);
        console.log(`Dimension: ${dimension}`);
        console.log(chalk.green('Database is valid.'));
      } catch (err) {
        console.log(chalk.yellow('Could not read database metadata:'), err instanceof Error ? err.message : String(err));
      }
    });

  // Path subcommand
  gloveCommand
    .command('path')
    .description('Print resolved GloVe database path')
    .option('-d, --directory <dir>', 'working directory', process.cwd())
    .action((options) => {
      const dbPath = resolveGlovePath(options.directory);
      if (dbPath) {
        console.log(dbPath);
      } else {
        console.log(chalk.red('No GloVe database found.'));
        process.exit(1);
      }
    });

  // Generate subcommand
  gloveCommand
    .command('generate')
    .description('Generate SQLite database from GloVe text file')
    .option('-i, --input <file>', 'input text file (GloVe format)')
    .option('-o, --output <file>', 'output SQLite database file')
    .option('-d, --dimension <dim>', 'dimension (50, 100, 300, or auto)', 'auto')
    .option('--streaming', 'use streaming conversion for large files', true)
    .option('--no-streaming', 'disable streaming conversion')
    .action(async (options) => {
      const cwd = process.cwd();
      let inputPath = options.input;
      let outputPath = options.output;
      
      // Determine input file
      if (!inputPath) {
        // Look for common glove text files in data/glove
        const possibleFiles = [
          'data/glove/glove.6B.50d.txt',
          'data/glove/glove.6B.100d.txt',
          'data/glove/glove.6B.300d.txt',
          'data/glove/wiki_giga_2024_50_MFT20_vectors_seed_123_alpha_0.75_eta_0.075_combined.txt',
        ];
        
        for (const file of possibleFiles) {
          const fullPath = path.resolve(cwd, file);
          if (fs.existsSync(fullPath)) {
            inputPath = fullPath;
            console.log(chalk.blue(`Found input file: ${inputPath}`));
            break;
          }
        }
        
        if (!inputPath) {
          console.error(chalk.red('No input file specified and no default GloVe text file found.'));
          console.error(chalk.gray('Please specify --input or place a GloVe text file in data/glove/.'));
          process.exit(1);
        }
      } else {
        inputPath = path.resolve(cwd, inputPath);
      }
      
      if (!fs.existsSync(inputPath)) {
        console.error(chalk.red(`Input file not found: ${inputPath}`));
        process.exit(1);
      }
      
      // Determine output file
      if (!outputPath) {
        const dimension = options.dimension === 'auto' ? '50' : options.dimension;
        const defaultName = `glove_${dimension}d.db`;
        outputPath = path.resolve(cwd, 'data/glove', defaultName);
      } else {
        outputPath = path.resolve(cwd, outputPath);
      }
      
      // Create output directory
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      console.log(chalk.bold('Generating GloVe SQLite database...'));
      console.log(`Input:  ${inputPath}`);
      console.log(`Output: ${outputPath}`);
      console.log(`Streaming: ${options.streaming ? 'yes' : 'no'}`);
      
      // Run conversion script
      const script = options.streaming
        ? 'scripts/convert-glove-to-sqlite-stream.ts'
        : 'scripts/convert-glove-to-sqlite.ts';
      
      const scriptPath = path.resolve(getInstallationRoot(), script);
      if (!fs.existsSync(scriptPath)) {
        console.error(chalk.red(`Conversion script not found: ${scriptPath}`));
        process.exit(1);
      }
      
      try {
        const { stdout, stderr } = await exec(`bun run "${scriptPath}" "${inputPath}" "${outputPath}"`);
        if (stderr) console.error(chalk.yellow(stderr));
        console.log(chalk.green('Database generated successfully!'));
        console.log(stdout);
      } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        // Check if the output file was created despite the error
        if (fs.existsSync(outputPath)) {
          console.log(chalk.yellow('Conversion script reported error, but output file exists. Validating...'));
          try {
            const { count, dimension } = await getGloveMetadata(outputPath);
            console.log(chalk.green(`Database appears valid: ${count} words, dimension ${dimension}`));
            console.log(chalk.yellow('Note: Verification step failed, but database may still be usable.'));
            return; // Success, exit without error
          } catch (validationError) {
            console.error(chalk.red('Database file exists but is invalid:'), validationError instanceof Error ? validationError.message : String(validationError));
            // Continue to exit with error
          }
        }
        
        console.error(chalk.red('Conversion failed:'), error.message);
        if (error.stdout) console.error(chalk.gray(error.stdout));
        if (error.stderr) console.error(chalk.red(error.stderr));
        process.exit(1);
      }
    });

  // Download subcommand
  gloveCommand
    .command('download')
    .description('Download GloVe embeddings from URL')
    .option('-u, --url <url>', 'URL to download (ZIP or text file)')
    .option('-d, --dimension <dim>', 'dimension (50, 100, 300)', '50')
    .option('-o, --output <file>', 'output SQLite database file (optional)')
    .action(async (_options) => {
      console.error(chalk.yellow('Download command not yet implemented.'));
      console.error(chalk.gray('Please manually download glove.6B.zip from https://nlp.stanford.edu/projects/glove/'));
      console.error(chalk.gray('Place it in data/glove/ and run `grok glove generate`.'));
      process.exit(1);
    });

  // Helper subcommand to list available dimensions
  gloveCommand
    .command('list-dimensions')
    .description('List available GloVe dimensions')
    .action(() => {
      console.log(chalk.bold('Common GloVe dimensions:'));
      console.log('  50  - glove.6B.50d.txt (most common, ~350MB text)');
      console.log('  100 - glove.6B.100d.txt');
      console.log('  300 - glove.6B.300d.txt');
      console.log(chalk.gray('\nCustom dimensions are also supported.'));
    });

  return gloveCommand;
}