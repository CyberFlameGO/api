import {apikey} from 'apikeygen';
import * as bodyParser from 'body-parser';
import {Container} from 'inversify';
import {InversifyExpressServer} from 'inversify-express-utils';
import * as morgan from 'morgan';
import {Connection, createConnection} from 'typeorm';
import {createLogger, format, Logger, transports} from 'winston';

import './Controller/IndexController';
import './Controller/ReportController';
import Consumer from './Entity/Consumer';
import Report from './Entity/Report';
import User from './Entity/User';
import {PERMISSIONS} from './Permissions';
import {default as Authorizer, setAuthorizorForMiddleware} from './Security/Authorizer';
import Types from './types';
import {Config, Vault} from './Vault';

let initialized          = false;
let container: Container = new Container({defaultScope: 'Singleton'});
let server               = new InversifyExpressServer(container);
let vault: Vault;
let connection: Connection;

server.setConfig((app) => {
    app.use(bodyParser.urlencoded({extended: true}));
    app.use(bodyParser.json());
    app.use(morgan('dev'));
});

async function createRootUser(_conn: Connection) {
    const repo       = _conn.getRepository<Consumer>(Consumer);
    let rootConsumer = await repo.findOne({name: 'root'});
    if (!!rootConsumer) {
        return;
    }

    rootConsumer             = new Consumer();
    rootConsumer.name        = 'root';
    rootConsumer.description = 'Root Consumer - Admin User';
    rootConsumer.permissions = PERMISSIONS.ADMINISTRATOR;
    rootConsumer.apiKey      = apikey(64);

    return rootConsumer.save();
}

export default async () => {
    if (!initialized) {
        // Logger
        container.bind<Logger>(Types.logger).toDynamicValue(() => createLogger({
            level:      process.env.DEBUG || false ? 'debug' : 'info',
            format:     format.combine(
                format.splat(),
                format.colorize(),
                format.timestamp(),
                format.align(),
                format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`),
            ),
            transports: [
                new transports.Console(),
            ],
        }));

        // Vault
        container.bind<Config>(Types.vault.config).toConstantValue({
            vaultFile: process.env.VAULT_FILE,
            address:   process.env.VAULT_ADDR,
            rootToken: process.env.VAULT_TOKEN,
            roleId:    process.env.VAULT_ROLE_ID,
            secretId:  process.env.VAULT_SECRET_ID,
        });
        container.bind<Vault>(Types.vault.client).to(Vault);
        vault = container.get<Vault>(Types.vault.client);
        await vault.initialize();

        // Database/TypeORM
        connection = await createConnection({
            synchronize:       true,
            host:              await vault.getSecret('database', 'host'),
            database:          await vault.getSecret('api/database', 'name'),
            port:              3306,
            username:          await vault.getSecret('api/database', 'user'),
            password:          await vault.getSecret('api/database', 'password'),
            type:              'mysql',
            supportBigNumbers: true,
            bigNumberStrings:  true,
            entities:          [
                Consumer,
                Report,
                User,
            ],
        });
        container.bind<Connection>(Types.database).toConstantValue(connection);
        await createRootUser(connection);

        // Authorizer
        container.bind<Authorizer>(Types.authorizer).to(Authorizer);
        setAuthorizorForMiddleware(container.get<Authorizer>(Types.authorizer));

        initialized = true;
    }

    return server.build();
};
