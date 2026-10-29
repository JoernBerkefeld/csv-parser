import { expectType } from 'tsd';
import csvParser, {
    validateFile,
    validateFiles,
    replayFiles,
    type ValidationResult,
    type FileSetValidation,
} from './index.js';

expectType<Promise<FileSetValidation>>(validateFiles(Object.freeze(['part1.csv', 'part2.csv']), {
    sanitizeBottom: true, sanitizeRightPadding: true, skipEmptyLines: false,
}));
expectType<Promise<FileSetValidation>>(validateFile('part.csv', { sanitizeBottom: true }));
const fileSet = await validateFiles(['part.csv']);
expectType<AsyncGenerator<any>>(replayFiles(fileSet));
expectType<number>(fileSet.cleanup.removedRecords);
expectType<readonly string[]>(fileSet.physicalHeaders);
// @ts-expect-error Metadata is immutable.
fileSet.recordCount = 1;
// @ts-expect-error File sanitizing only accepts booleans.
validateFiles(['part.csv'], { sanitizeBottom: 'true' });

const options: csvParser.Options = {};

expectType<csvParser.CsvParser>(csvParser());
expectType<csvParser.CsvParser>(csvParser(options));
expectType<csvParser.CsvParser>(csvParser({ outputByteOffset: true }));
expectType<csvParser.CsvParser>(csvParser({ bom: true }));
expectType<csvParser.CsvParser>(csvParser({ bom: false }));
expectType<boolean | undefined>(options.bom);
// @ts-expect-error The BOM option is readonly.
options.bom = true;
// @ts-expect-error The BOM option only accepts booleans.
csvParser({ bom: 'true' });
// @ts-expect-error The BOM option only accepts booleans.
csvParser({ bom: 1 });

expectType<csvParser.CsvParser>(csvParser(['Name', 'Age']));
expectType<csvParser.CsvParser>(csvParser({ escape: '"' }));
expectType<csvParser.CsvParser>(csvParser({ headers: ['Name', 'Age'] }));
expectType<csvParser.CsvParser>(csvParser({ headers: false }));
expectType<csvParser.CsvParser>(
    csvParser({
        mapHeaders: ({ header, index }) => {
            expectType<string>(header);
            expectType<number>(index);
            return header.toLowerCase();
        },
    }),
);
expectType<csvParser.CsvParser>(csvParser({ mapHeaders: ({ header, index }) => null }));
expectType<csvParser.CsvParser>(
    csvParser({
        mapValues: ({ header, index, value }) => {
            expectType<string>(header);
            expectType<number>(index);
            expectType<any>(value);

            return value.toLowerCase();
        },
    }),
);
expectType<csvParser.CsvParser>(csvParser({ mapValues: ({ header, index, value }) => null }));
expectType<csvParser.CsvParser>(csvParser({ newline: '\n' }));
expectType<csvParser.CsvParser>(csvParser({ quote: '"' }));
expectType<csvParser.CsvParser>(csvParser({ raw: true }));
expectType<csvParser.CsvParser>(
    csvParser({
        raw: true,
        mapHeaders: ({ header, index }) => {
            expectType<string>(header);
            expectType<number>(index);
            return header.toLowerCase();
        },
        mapValues: ({ header, value }) => {
            expectType<string>(header);
            expectType<any>(value);
            return value;
        },
    }),
);
expectType<csvParser.CsvParser>(csvParser({ separator: ',' }));
expectType<csvParser.CsvParser>(csvParser({ skipComments: true }));
expectType<csvParser.CsvParser>(csvParser({ skipComments: '#' }));
expectType<csvParser.CsvParser>(csvParser({ skipEmptyLines: true }));
expectType<csvParser.CsvParser>(csvParser({ skipEmptyLines: false }));
expectType<boolean | undefined>(options.sanitizeRightPadding);
expectType<csvParser.CsvParser>(csvParser({ sanitizeRightPadding: true }));
expectType<Promise<ValidationResult>>(validateFile('synthetic.csv', { sanitizeRightPadding: false }));
// @ts-expect-error The right-padding option only accepts booleans.
csvParser({ sanitizeRightPadding: 'true' });
// @ts-expect-error The right-padding option is readonly.
options.sanitizeRightPadding = true;
expectType<boolean | undefined>(options.skipEmptyLines);
// @ts-expect-error The empty-line option is readonly.
options.skipEmptyLines = true;
// @ts-expect-error The empty-line option only accepts booleans.
csvParser({ skipEmptyLines: 'true' });
// @ts-expect-error The empty-line option only accepts booleans.
csvParser({ skipEmptyLines: 1 });
expectType<Promise<ValidationResult>>(validateFile('synthetic.csv', { skipEmptyLines: true }));
expectType<Promise<ValidationResult>>(validateFile('synthetic.csv', { skipEmptyLines: false }));
// @ts-expect-error Validation shares the boolean-only empty-line option.
validateFile('synthetic.csv', { skipEmptyLines: 'true' });
// @ts-expect-error Validation shares the boolean-only empty-line option.
validateFile('synthetic.csv', { skipEmptyLines: 1 });
expectType<csvParser.CsvParser>(csvParser({ skipLines: 1 }));
expectType<csvParser.CsvParser>(csvParser({ maxRowBytes: 1 }));
expectType<csvParser.CsvParser>(csvParser({ strict: true }));
expectType<csvParser.CsvParser>(csvParser({ strictQuotes: true }));
expectType<csvParser.CsvParser>(csvParser({ strictQuotes: false, strict: true }));

expectType<Promise<ValidationResult>>(validateFile('synthetic.csv'));
expectType<Promise<ValidationResult>>(validateFile('synthetic.csv', options));
expectType<Promise<ValidationResult>>(validateFile('synthetic.csv', { bom: true }));
expectType<Promise<ValidationResult>>(validateFile('synthetic.csv', { bom: false }));
// @ts-expect-error Validation shares the boolean-only BOM option.
validateFile('synthetic.csv', { bom: 'true' });
// @ts-expect-error Validation shares the boolean-only BOM option.
validateFile('synthetic.csv', { bom: 1 });
expectType<Promise<ValidationResult>>(validateFile('synthetic.csv', ['a', 'b'] as const));
expectType<Promise<ValidationResult>>(
    validateFile('synthetic.csv', { headers: false, strictQuotes: true }),
);
expectType<(string | null)[] | false | null>((await validateFile('synthetic.csv')).headers);
expectType<number>((await validateFile('synthetic.csv')).recordCount);
// @ts-expect-error Only filesystem string paths are accepted.
validateFile(Buffer.from('synthetic.csv'));
// @ts-expect-error URL paths are outside the helper contract.
validateFile(new URL('file:///synthetic.csv'));
