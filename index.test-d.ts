import { expectType } from 'tsd';
import csvParser from './index.js';

const options: csvParser.Options = {};

expectType<csvParser.CsvParser>(csvParser());
expectType<csvParser.CsvParser>(csvParser(options));
expectType<csvParser.CsvParser>(csvParser({ outputByteOffset: true }));

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
expectType<csvParser.CsvParser>(csvParser({ skipLines: 1 }));
expectType<csvParser.CsvParser>(csvParser({ maxRowBytes: 1 }));
expectType<csvParser.CsvParser>(csvParser({ strict: true }));
