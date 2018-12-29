import 'reflect-metadata';
import 'source-map-support/register';

import Kernel from './Kernel';

Kernel().then((app) => app.listen(3000, () => console.log('Listening on http://localhost:3000')));
