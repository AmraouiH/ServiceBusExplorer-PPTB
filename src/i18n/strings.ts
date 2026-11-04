import type { ConnectionMethod, MatchStatus, RuleFilterKind, SbKind } from '../models/types';

export type Language = 'en' | 'fr';

export const AppTitle = 'ServiceBus Explorer';
export const AuthorName = 'Hamza AMRAOUI';

const n0 = (value: number, fr: boolean) => value.toLocaleString(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });
const n2 = (value: number, fr: boolean) => value.toLocaleString(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 });

/** Every user-facing text of the tool, in English and French (port of Localization/Strings.cs). */
function build(fr: boolean) {
    const T = (english: string, french: string) => (fr ? french : english);
    const N = (value: number) => n0(value, fr);

    const stageLabel = (stage: number) =>
        stage === 10 ? T('Pre-validation', 'Pré-validation') : stage === 20 ? T('Pre-operation', 'Pré-opération') : stage === 40 ? T('Post-operation', 'Post-opération') : String(stage);
    const modeLabel = (mode: number) => (mode === 1 ? T('Asynchronous', 'Asynchrone') : T('Synchronous', 'Synchrone'));
    const imageTypeLabel = (type: number) => (type === 0 ? 'Pre' : type === 1 ? 'Post' : 'Pre + Post');
    const queueCaption = (active: number, dead: number) =>
        dead > 0 ? T(`${N(active)} active · ${N(dead)} dead-letter`, `${N(active)} actifs · ${N(dead)} dead-letter`) : T(`${N(active)} active`, `${N(active)} actifs`);

    return {
        yes: T('Yes', 'Oui'),
        no: T('No', 'Non'),
        empty: T('(empty)', '(vide)'),
        ok: 'OK',
        cancel: T('Cancel', 'Annuler'),
        close: T('Close', 'Fermer'),
        apply: T('Apply', 'Appliquer'),
        save: T('Save', 'Enregistrer'),
        add: T('Add', 'Ajouter'),
        remove: T('Remove', 'Retirer'),
        copy: T('Copy', 'Copier'),
        copied: T('Copied', 'Copié'),
        details: T('Details', 'Détails'),
        wordWrap: T('Word wrap', 'Retour à la ligne'),
        stop: T('Stop', 'Arrêter'),
        stopped: T('Stopped.', 'Arrêté.'),
        somethingWentWrong: T('Something went wrong', 'Une erreur est survenue'),

        // #region Header
        appSubtitle: T('Azure Service Bus and the Dataverse steps that feed it', 'Azure Service Bus et les steps Dataverse qui l’alimentent'),
        load: T('Load', 'Charger'),
        loadTip: T(
            'Read the namespaces on Azure and the service endpoints, steps and images of Dataverse',
            'Lit les namespaces sur Azure et les service endpoints, steps et images de Dataverse',
        ),
        connections: T('Azure connections', 'Connexions Azure'),
        exportReport: T('Export', 'Exporter'),
        exportTip: T('Excel report: matching, steps, images, Azure entities and filters', 'Rapport Excel : matching, steps, images, entités Azure et filtres'),
        options: T('Options', 'Options'),
        languageMenu: T('Language', 'Langue'),
        help: T('Help', 'Aide'),
        donate: T('Donate', 'Faire un don'),
        donateTip: T('Support the tool (PayPal)', 'Soutenir l’outil (PayPal)'),
        authorTip: T('Developed by Hamza AMRAOUI (LinkedIn)', 'Développé par Hamza AMRAOUI (LinkedIn)'),
        connectedTo: (name: string) => T(`Connected to ${name}`, `Connecté à ${name}`),
        notConnected: T('No Dataverse connection', 'Aucune connexion Dataverse'),
        // #endregion

        // #region Loading
        loading: T('Loading…', 'Chargement…'),
        saving: T('Saving…', 'Enregistrement…'),
        preparingEditor: T('Preparing the editor…', 'Préparation de l’éditeur…'),
        readingEndpoints: T('Reading the service endpoints…', 'Lecture des service endpoints…'),
        readingSteps: T('Reading the steps and images…', 'Lecture des steps et des images…'),
        readingNamespace: (name: string) => T(`Reading ${name}…`, `Lecture de ${name}…`),
        readingQueues: (name: string) => T(`${name}: reading the queues…`, `${name} : lecture des queues…`),
        readingTopics: (name: string) => T(`${name}: reading the topics…`, `${name} : lecture des topics…`),
        readingSubscriptions: (name: string, topics: number) => T(`${name}: reading the subscriptions of ${topics} topic(s)…`, `${name} : lecture des souscriptions de ${topics} topic(s)…`),
        readingRules: (name: string, subscriptions: number) => T(`${name}: reading the filters of ${subscriptions} subscription(s)…`, `${name} : lecture des filtres de ${subscriptions} souscription(s)…`),
        writingStep: (name: string) => T(`Saving ${name}…`, `Enregistrement de ${name}…`),
        signingIn: T('Waiting for the sign-in…', 'En attente de la connexion…'),
        noDataverse: T('Connect to a Dataverse environment first (ToolBox connection).', 'Connectez-vous d’abord à un environnement Dataverse (connexion du ToolBox).'),
        // #endregion

        // #region Azure
        invalidConnectionString: T('This is not a Service Bus connection string: Endpoint=sb://… is missing.', 'Ce n’est pas une connection string Service Bus : Endpoint=sb://… est absent.'),
        connectionStringNoKey: T('The connection string has no shared access key.', 'La connection string ne contient pas de clé d’accès partagé.'),
        connectionStringEntityScoped: T(
            'This connection string is limited to one entity (EntityPath). Use a namespace-level key with the Manage right, or sign in with a Microsoft account.',
            'Cette connection string est limitée à une entité (EntityPath). Utilisez une clé au niveau du namespace avec le droit Manage, ou connectez-vous avec un compte Microsoft.',
        ),
        secretMissing: T(
            'The connection string of this namespace is not remembered: add it again in Azure connections (tick « Remember » to keep it).',
            'La connection string de ce namespace n’est pas mémorisée : ajoutez-la de nouveau dans Connexions Azure (cochez « Mémoriser » pour la garder).',
        ),
        azureUnreachable: (host: string) => T(`${host} cannot be reached.`, `${host} est injoignable.`),
        azureAccessDenied: (host: string) =>
            T(
                `Access to ${host} was refused. A connection string needs a namespace-level key with the Manage right; a Microsoft account needs at least the Reader role.`,
                `L’accès à ${host} a été refusé. Une connection string nécessite une clé au niveau du namespace avec le droit Manage ; un compte Microsoft nécessite au moins le rôle Reader.`,
            ),
        azureNotFound: T('Azure does not know this resource.', 'Azure ne connaît pas cette ressource.'),
        azureThrottled: T('Azure is limiting the requests. Wait a little, or lower the parallel requests in the options.', 'Azure limite les requêtes. Patientez un peu, ou réduisez les requêtes parallèles dans les options.'),
        azureFailed: (status: number) => T(`Azure answered with an error (HTTP ${status}).`, `Azure a répondu par une erreur (HTTP ${status}).`),
        azureBlocked: (host: string) =>
            T(
                `${host} cannot be reached. If the ToolBox asked to allow the network access of the tool, accept it, then try again.`,
                `${host} est injoignable. Si le ToolBox a demandé d’autoriser l’accès réseau de l’outil, acceptez-le, puis réessayez.`,
            ),
        azureCliMissing: T('The Azure CLI is not installed, or not on the PATH.', 'Azure CLI n’est pas installé, ou absent du PATH.'),
        azureCliFailed: T('The Azure CLI could not give a token. Run « az login » in a terminal, then try again.', 'Azure CLI n’a pas pu fournir de jeton. Lancez « az login » dans un terminal, puis réessayez.'),
        signInFailed: T('The sign-in failed.', 'La connexion a échoué.'),
        signInExpired: T('The sign-in code expired before it was used.', 'Le code de connexion a expiré avant d’être utilisé.'),
        signInCancelled: T('The sign-in was cancelled.', 'La connexion a été annulée.'),
        deviceCodeTitle: T('Sign in with your Microsoft account', 'Connexion avec votre compte Microsoft'),
        deviceCodeText: (url: string) =>
            T(`Open ${url} in a browser and enter this code. The tool waits for the sign-in.`, `Ouvrez ${url} dans un navigateur et saisissez ce code. L’outil attend la connexion.`),
        openSignInPage: T('Open the sign-in page', 'Ouvrir la page de connexion'),
        copyCode: T('Copy the code', 'Copier le code'),
        // #endregion

        // #region Tabs and explorer
        tabExplorer: T('Explorer', 'Explorateur'),
        tabMatching: T('Matching', 'Matching'),
        tabSteps: T('Steps', 'Steps'),
        treeTitle: 'Azure Service Bus',
        treeSubtitle: T('Namespaces, queues, topics', 'Namespaces, queues, topics'),
        treeFilterCue: T('Filter by name…', 'Filtrer par nom…'),
        onlyWithSteps: T('Only items with Dataverse steps', 'Uniquement les éléments avec des steps Dataverse'),
        addNamespaceTip: T('Add a namespace', 'Ajouter un namespace'),
        treeEmpty: T(
            'Add a namespace with Azure connections, then click Load.\n\nWithout a connection, Load still shows the namespaces used by the Dataverse steps.',
            'Ajoutez un namespace avec Connexions Azure, puis cliquez sur Charger.\n\nSans connexion, Charger affiche quand même les namespaces utilisés par les steps Dataverse.',
        ),
        treeNoMatch: T('Nothing matches this filter.', 'Rien ne correspond à ce filtre.'),
        detailEmptyTitle: T('Select an item', 'Sélectionnez un élément'),
        detailEmpty: T(
            'Pick a namespace, a queue, a topic or a subscription in the tree to see its Dataverse steps, its filters, its properties and its messages.',
            'Choisissez un namespace, une queue, un topic ou une souscription dans l’arbre pour voir ses steps Dataverse, ses filtres, ses propriétés et ses messages.',
        ),
        groupQueues: T('Queues', 'Queues'),
        groupTopics: T('Topics', 'Topics'),
        kindLabel: (kind: SbKind) => (kind === 'queue' ? 'Queue' : kind === 'topic' ? 'Topic' : T('Subscription', 'Souscription')),
        namespaceCaption: (queues: number, topics: number) => `${queues} queue(s) · ${topics} topic(s)`,
        queueCaption,
        topicCaption: (subscriptions: number) => T(`${subscriptions} subscription(s)`, `${subscriptions} souscription(s)`),
        subscriptionCaption: (rules: number, active: number, dead: number) => `${rules} ${T('filter(s)', 'filtre(s)')} · ${queueCaption(active, dead)}`,
        pillSteps: (count: number) => `${count} step${count > 1 ? 's' : ''}`,
        pillDeadLetter: 'DLQ',
        pillNotConnected: T('Not connected', 'Non connecté'),
        pillError: T('Error', 'Erreur'),
        pillMissing: T('Missing', 'Absent'),
        pillDisabled: T('Disabled', 'Désactivé'),

        tileActive: T('Active messages', 'Messages actifs'),
        tileDeadLetter: 'Dead-letter',
        tileScheduled: T('Scheduled', 'Planifiés'),
        tileSize: T('Size used', 'Taille utilisée'),
        tileSteps: T('Dataverse steps', 'Steps Dataverse'),
        tileSubscriptions: T('Subscriptions', 'Souscriptions'),
        tileQueues: 'Queues',
        tileTopics: 'Topics',

        detailSteps: T('Dataverse steps', 'Steps Dataverse'),
        detailFilters: T('Subscriptions and filters', 'Souscriptions et filtres'),
        detailFiltersOnly: T('Filters', 'Filtres'),
        detailProperties: T('Properties', 'Propriétés'),
        detailMessages: 'Messages',
        subscriptionStepsHint: (topic: string) => T(`These steps publish to the topic ${topic}, which feeds this subscription.`, `Ces steps publient sur le topic ${topic}, qui alimente cette souscription.`),
        alertGhostNamespace: (host: string) =>
            T(`${host} is used by Dataverse but is not connected: its queues and topics cannot be compared with Azure.`, `${host} est utilisé par Dataverse mais n’est pas connecté : ses queues et topics ne peuvent pas être comparés avec Azure.`),
        alertGhostEntity: T('This entity does not exist on Azure: the steps below will fail when they run.', 'Cette entité n’existe pas sur Azure : les steps ci-dessous échoueront à l’exécution.'),
        alertNamespaceError: (message: string) => T(`This namespace could not be read. ${message}`, `Ce namespace n’a pas pu être lu. ${message}`),
        alertEntityDisabled: (status: string) => T(`This entity is not active on Azure (status: ${status}).`, `Cette entité n’est pas active sur Azure (statut : ${status}).`),
        connectNamespace: T('Connect', 'Connecter'),

        colSubscription: T('Subscription', 'Souscription'),
        colActive: T('Active', 'Actifs'),
        colDeadLetter: 'Dead-letter',
        colFilters: T('Filters', 'Filtres'),
        colForwardTo: T('Forward to', 'Transfert vers'),
        colStatus: T('Status', 'Statut'),
        colRule: T('Rule', 'Règle'),
        colType: 'Type',
        colExpression: T('Filter', 'Filtre'),
        colAction: 'Action',
        filterKindLabel: (kind: RuleFilterKind) =>
            kind === 'sql' ? 'SQL' : kind === 'correlation' ? T('Correlation', 'Corrélation') : kind === 'true' ? T('All messages', 'Tous les messages') : T('No message', 'Aucun message'),
        filterAll: T('All messages', 'Tous les messages'),
        selectedFilter: T('Selected filter', 'Filtre sélectionné'),
        noFilterSelected: T('Select a rule to read its full filter.', 'Sélectionnez une règle pour lire son filtre complet.'),
        ruleAction: 'Action',

        propHost: T('Host', 'Hôte'),
        propLocation: T('Location', 'Région'),
        propTier: T('Tier', 'Niveau'),
        propStatus: T('Status', 'Statut'),
        propAzureSubscription: T('Azure subscription', 'Abonnement Azure'),
        propAccess: T('Read with', 'Lu avec'),
        propAccessKey: 'Connection string',
        propAccessMicrosoft: T('Microsoft account', 'Compte Microsoft'),
        propType: 'Type',
        propPath: T('Path', 'Chemin'),
        propTotal: T('Total messages', 'Total des messages'),
        propTransfer: T('Transfer messages', 'Messages en transfert'),
        propMaxSize: T('Maximum size', 'Taille maximale'),
        propLock: T('Lock duration', 'Durée de verrouillage'),
        propTtl: T('Default message time to live', 'Durée de vie par défaut des messages'),
        propAutoDelete: T('Auto delete on idle', 'Suppression auto. si inactif'),
        propMaxDelivery: T('Maximum delivery count', 'Nombre maximal de livraisons'),
        propSessions: 'Sessions',
        propDuplicate: T('Duplicate detection', 'Détection des doublons'),
        propDeadLetterExpiry: T('Dead-letter on expiration', 'Dead-letter à l’expiration'),
        propPartitioned: T('Partitioned', 'Partitionné'),
        propForwardTo: T('Forward to', 'Transfert vers'),
        propForwardDead: T('Forward dead-letter to', 'Transfert du dead-letter vers'),
        propCreated: T('Created on', 'Créé le'),
        propUpdated: T('Updated on', 'Modifié le'),
        propAccessed: T('Last accessed on', 'Dernier accès le'),
        propEndpoints: T('Dataverse endpoints', 'Endpoints Dataverse'),
        unlimited: T('Unlimited', 'Illimité'),
        days: (value: number) => T(`${n2(value, fr)} day(s)`, `${n2(value, fr)} jour(s)`),
        hours: (value: number) => `${n2(value, fr)} h`,
        minutes: (value: number) => `${n2(value, fr)} min`,
        seconds: (value: number) => `${n2(value, fr)} s`,
        // #endregion

        // #region Matching
        matchTitle: 'Dataverse ↔ Azure',
        matchSubtitle: T('Double-click a line to open it in the explorer', 'Double-cliquez sur une ligne pour l’ouvrir dans l’explorateur'),
        matchSearchCue: T('Search an endpoint or a path…', 'Rechercher un endpoint ou un chemin…'),
        matchAll: T('All statuses', 'Tous les statuts'),
        matchProblems: T('To check', 'À vérifier'),
        matchCount: (visible: number, total: number) => T(`${visible} of ${total} line(s)`, `${visible} sur ${total} ligne(s)`),
        openInExplorer: T('Open in the explorer', 'Ouvrir dans l’explorateur'),
        tileEndpoints: 'Endpoints',
        tileLinked: T('Linked', 'Liés'),
        tileProblems: T('To check', 'À vérifier'),
        tileNotConnected: T('Not connected', 'Non connectés'),
        tileUnused: T('Azure without endpoint', 'Azure sans endpoint'),
        tileAllSteps: 'Steps',
        tileEnabledSteps: T('Enabled steps', 'Steps actifs'),
        colMatch: T('Status', 'Statut'),
        colEndpoint: 'Endpoint',
        colContract: 'Type',
        colNamespace: 'Namespace',
        colPath: 'Queue / topic',
        colSteps: 'Steps',
        colImages: 'Images',
        colMessages: 'Messages',
        statusLabel: (status: MatchStatus) =>
            ({
                linked: T('Linked', 'Lié'),
                noSteps: T('No steps', 'Sans step'),
                missingOnAzure: T('Missing on Azure', 'Absent d’Azure'),
                typeMismatch: T('Wrong type', 'Mauvais type'),
                notConnected: T('Not connected', 'Non connecté'),
                noEndpoint: T('No endpoint', 'Sans endpoint'),
                otherType: T('Other type', 'Autre type'),
            })[status],
        contractLabel: (contract: number) =>
            ({
                1: 'OneWay',
                2: 'Queue',
                3: 'REST',
                4: 'TwoWay',
                5: 'Topic',
                6: T('Queue (persistent)', 'Queue (persistante)'),
                7: 'Event Hub',
                8: 'Webhook',
                9: 'Event Grid',
                10: 'Managed Data Lake',
                11: 'Container Storage',
            })[contract] ?? String(contract),
        // #endregion

        // #region Steps
        stepsTitle: T('Steps sending to Azure', 'Steps qui envoient vers Azure'),
        stepsSubtitle: T('Double-click a step to edit its trigger and images', 'Double-cliquez sur un step pour modifier son trigger et ses images'),
        stepsSearchCue: T('Search a table, a message, a column…', 'Rechercher une table, un message, une colonne…'),
        stepCount: (visible: number, total: number) => T(`${visible} of ${total} step(s)`, `${visible} sur ${total} step(s)`),
        noSteps: T('No Dataverse step sends to this item.', 'Aucun step Dataverse n’envoie vers cet élément.'),
        edit: T('Edit', 'Modifier'),
        editStepTip: T('Edit the trigger and the images of the selected step', 'Modifier le trigger et les images du step sélectionné'),
        enable: T('Enable', 'Activer'),
        disable: T('Disable', 'Désactiver'),
        enabled: T('Enabled', 'Activé'),
        disabled: T('Disabled', 'Désactivé'),
        managed: T('Managed', 'Managé'),
        colState: T('State', 'État'),
        colStep: 'Step',
        colMessage: 'Message',
        colTable: 'Table',
        colStage: 'Stage',
        colMode: 'Mode',
        colRank: T('Rank', 'Rang'),
        colFiltering: T('Filtering columns', 'Colonnes de filtrage'),
        colTarget: 'Queue / topic',
        colName: T('Name', 'Nom'),
        colAlias: 'Alias',
        colColumns: T('Columns', 'Colonnes'),
        imagesOfStep: (step: string) => T(`Images of ${step}`, `Images de ${step}`),
        imagesNoStep: T('Images of the selected step', 'Images du step sélectionné'),
        allTables: T('All tables', 'Toutes les tables'),
        allColumns: T('All columns', 'Toutes les colonnes'),
        allColumnsTrigger: T('All columns (any update)', 'Toutes les colonnes (toute modification)'),
        stageLabel,
        modeLabel,
        imageTypeLabel,
        confirmBulkTitle: (enable: boolean) => (enable ? T('Enable the steps', 'Activer les steps') : T('Disable the steps', 'Désactiver les steps')),
        confirmBulkMessage: (count: number, enable: boolean) =>
            enable
                ? T(`${count} step(s) will send messages to Azure again.`, `${count} step(s) enverront de nouveau des messages vers Azure.`)
                : T(`${count} step(s) will stop sending messages to Azure until they are enabled again.`, `${count} step(s) n’enverront plus de messages vers Azure jusqu’à leur réactivation.`),
        confirmBulkQuestion: T('Apply this change in Dataverse?', 'Appliquer ce changement dans Dataverse ?'),
        bulkSkipped: (count: number) => T(`${count} managed step(s) cannot be changed and are left out.`, `${count} step(s) managé(s) non modifiable(s) sont ignorés.`),
        nothingToChange: T('All the selected steps are already in this state, or are read-only.', 'Tous les steps sélectionnés sont déjà dans cet état, ou sont en lecture seule.'),
        bulkDone: (count: number) => T(`${count} step(s) updated.`, `${count} step(s) mis à jour.`),
        bulkFailed: (done: number, total: number) => T(`${done} of ${total} step(s) updated before the error.`, `${done} step(s) sur ${total} mis à jour avant l’erreur.`),
        stepSaved: (name: string) => T(`${name} was saved.`, `${name} a été enregistré.`),
        // #endregion

        // #region Step editor
        editorTitle: T('Edit the step', 'Modifier le step'),
        triggerTitle: 'Trigger',
        triggerSubtitle: T('What sends the message to Azure', 'Ce qui envoie le message vers Azure'),
        imagesTitle: 'Images',
        imagesSubtitle: T('Record data added to the message', 'Données de l’enregistrement ajoutées au message'),
        fieldMessage: 'Message',
        fieldTable: 'Table',
        fieldStage: 'Stage',
        fieldMode: 'Mode',
        fieldRank: T('Rank', 'Rang'),
        fieldFiltering: T('Filtering columns', 'Colonnes de filtrage'),
        fieldDeleteJob: T('Delete the system job on success', 'Supprimer le job système en cas de succès'),
        fieldName: T('Name', 'Nom'),
        fieldDescription: 'Description',
        selectColumns: T('Select…', 'Choisir…'),
        clearColumns: T('Clear', 'Effacer'),
        filteringOnlyUpdate: T('Only the Update message has filtering columns.', 'Seul le message Update possède des colonnes de filtrage.'),
        imagesHint: T(
            'Images travel inside the message: keep only the columns the receiver needs. A Service Bus message is limited to 256 KB on the Standard tier.',
            'Les images voyagent dans le message : ne gardez que les colonnes utiles au destinataire. Un message Service Bus est limité à 256 Ko en niveau Standard.',
        ),
        readOnlyStep: T('This step is managed and not customizable: it is read-only.', 'Ce step est managé et non personnalisable : il est en lecture seule.'),
        managedStepWarning: T(
            'This step comes from a managed solution: the change creates an unmanaged layer above it.',
            'Ce step vient d’une solution managée : le changement crée une couche non gérée au-dessus.',
        ),
        reviewTitle: T('Review the changes', 'Vérifier les changements'),
        reviewMessage: (step: string) => T(`These changes will be written to ${step}:`, `Ces changements seront écrits sur ${step} :`),
        reviewQuestion: T('Save them in Dataverse?', 'Les enregistrer dans Dataverse ?'),
        noChanges: T('Nothing to save: the step has not changed.', 'Rien à enregistrer : le step n’a pas changé.'),
        changeImageAdded: (image: string) => T(`Image added: ${image}`, `Image ajoutée : ${image}`),
        changeImageUpdated: (before: string, after: string) => T(`Image changed: ${before}  →  ${after}`, `Image modifiée : ${before}  →  ${after}`),
        changeImageRemoved: (image: string) => T(`Image removed: ${image}`, `Image retirée : ${image}`),
        tableRequired: T('This message needs a table.', 'Ce message nécessite une table.'),
        ruleMessageRequired: T('Choose a message.', 'Choisissez un message.'),
        ruleAsyncPostOnly: T('An asynchronous step only runs in Post-operation.', 'Un step asynchrone ne s’exécute qu’en Post-opération.'),
        ruleRank: T('The rank must be 1 or more.', 'Le rang doit être supérieur ou égal à 1.'),
        ruleFilteringUpdateOnly: T('Filtering columns only exist on the Update message.', 'Les colonnes de filtrage n’existent que sur le message Update.'),
        ruleNoImages: (message: string) => T(`The ${message} message has no images: remove them first.`, `Le message ${message} n’a pas d’images : retirez-les d’abord.`),
        ruleImageAlias: (name: string) => T(`The image ${name} needs an alias.`, `L’image ${name} doit avoir un alias.`),
        ruleImageType: (image: string, type: string, message: string, stage: string) =>
            T(`The image ${image}: a ${type} image is not available on ${message} in ${stage}.`, `Image ${image} : une image ${type} n’est pas disponible sur ${message} en ${stage}.`),
        ruleImageDuplicate: (alias: string) => T(`Two images use the alias ${alias}.`, `Deux images utilisent l’alias ${alias}.`),
        imageEditorAdd: T('Add an image', 'Ajouter une image'),
        imageEditorEdit: T('Edit the image', 'Modifier l’image'),
        fieldImageType: 'Type',
        fieldAlias: 'Alias',
        fieldColumns: T('Columns', 'Colonnes'),
        columnsAll: T('All columns', 'Toutes les colonnes'),
        columnsSelected: T('Selected columns', 'Colonnes choisies'),
        allColumnsWarning: T(
            'All columns can make the message heavy: prefer the columns the receiver needs.',
            'Toutes les colonnes peuvent alourdir le message : préférez celles dont le destinataire a besoin.',
        ),
        imageNeedsColumns: T('Select at least one column, or choose All columns.', 'Choisissez au moins une colonne, ou Toutes les colonnes.'),
        imageNeedsAlias: T('Enter an alias.', 'Saisissez un alias.'),
        pickerTitle: T('Select the columns', 'Choisir les colonnes'),
        pickerSearchCue: T('Search a column…', 'Rechercher une colonne…'),
        pickerOnlySelected: T('Selected only', 'Uniquement la sélection'),
        pickerLoading: T('Reading the columns…', 'Lecture des colonnes…'),
        pickerCount: (count: number) => T(`${count} column(s) selected`, `${count} colonne(s) sélectionnée(s)`),
        colDisplayName: T('Display name', 'Nom d’affichage'),
        colLogicalName: T('Logical name', 'Nom logique'),
        // #endregion

        // #region Messages
        messagesButton: 'Messages',
        messagesButtonTip: T(
            'Peek the active messages sent by the selected step(s) (the dead-letter queue is not read)',
            'Lire les messages actifs envoyés par le ou les steps sélectionnés (la dead-letter queue n’est pas lue)',
        ),
        readMessages: T('Read active messages', 'Lire les messages actifs'),
        readMessagesTip: T(
            'Peek the active messages waiting: nothing is locked or removed, and their delivery count does not change. The dead-letter queue is not read.',
            'Lit les messages actifs en attente : rien n’est verrouillé ni retiré, et leur nombre de livraisons ne change pas. La dead-letter queue n’est pas lue.',
        ),
        readingMessagesShort: T('Reading…', 'Lecture…'),
        readingMessages: (path: string) => T(`Reading the active messages of ${path}…`, `Lecture des messages actifs de ${path}…`),
        onlyStepMessages: T('Only this step', 'Seulement ce step'),
        onlyStepsMessages: T('Only these steps', 'Seulement ces steps'),
        messagesSearchCue: T('Search step, table, record, ID, body…', 'Rechercher step, table, ligne, ID, contenu…'),
        peekHint: T(
            'Active messages only: the dead-letter queue is not read. Nothing is locked or removed, and the delivery count does not change.',
            'Messages actifs uniquement : la dead-letter queue n’est pas lue. Rien n’est verrouillé ni retiré, et le nombre de livraisons ne change pas.',
        ),
        messagesIntro: (name: string, sources: number) =>
            sources > 1
                ? T(`Click « Read active messages » to see the active messages waiting in the ${sources} subscriptions of ${name}.`, `Cliquez sur « Lire les messages actifs » pour voir les messages actifs en attente dans les ${sources} souscriptions de ${name}.`)
                : T(`Click « Read active messages » to see the active messages waiting in ${name}.`, `Cliquez sur « Lire les messages actifs » pour voir les messages actifs en attente dans ${name}.`),
        messagesUnavailable: T(
            'This entity was not read on Azure: its messages cannot be peeked. Connect its namespace, then click Load.',
            'Cette entité n’a pas été lue sur Azure : ses messages ne peuvent pas être lus. Connectez son namespace, puis cliquez sur Charger.',
        ),
        messagesNone: T(
            'No active message is waiting. Consumers may already have taken them: a peek only sees what is still in the queue.',
            'Aucun message actif en attente. Les consommateurs les ont peut-être déjà pris : la lecture ne voit que ce qui est encore dans la file.',
        ),
        messagesNoneForStep: (read: number) =>
            T(`None of the ${read} active message(s) read was sent by this step. Uncheck « Only this step » to see them.`, `Aucun des ${read} message(s) actif(s) lus n’a été envoyé par ce step. Décochez « Seulement ce step » pour les voir.`),
        messagesNoMatch: T('No message matches the search.', 'Aucun message ne correspond à la recherche.'),
        messagesAllFailed: T('The messages could not be read: see the details above.', 'Les messages n’ont pas pu être lus : voir les détails ci-dessus.'),
        messagesCount: (shown: number, total: number) =>
            shown === total ? T(`${N(total)} active message(s)`, `${N(total)} message(s) actif(s)`) : T(`${N(shown)} of ${N(total)} active message(s)`, `${N(shown)} sur ${N(total)} message(s) actif(s)`),
        messagesTruncated: (max: number) => T(` · limit of ${N(max)} per queue reached (Options)`, ` · limite de ${N(max)} par file atteinte (Options)`),
        messagesErrors: (count: number, first: string) => T(`${count} queue(s) could not be read, starting with ${first}.`, `${count} file(s) n’ont pas pu être lues, à commencer par ${first}.`),
        messagesErrorsTitle: T('Messages not read', 'Messages non lus'),
        messagesAccessDenied: (host: string) =>
            T(
                `Reading the messages of ${host} was refused. A connection string needs the Listen right; a Microsoft account needs the « Azure Service Bus Data Receiver » role (Reader and Owner are not enough).`,
                `La lecture des messages de ${host} a été refusée. Une connection string nécessite le droit Listen ; un compte Microsoft nécessite le rôle « Azure Service Bus Data Receiver » (Reader et Owner ne suffisent pas).`,
            ),
        messagesFailed: T('Service Bus refused to give the messages.', 'Service Bus a refusé de donner les messages.'),
        stepMessagesTitle: (steps: number) => (steps > 1 ? T('Messages of the steps', 'Messages des steps') : T('Messages of the step', 'Messages du step')),
        stepMessagesSubtitle: (steps: number, targets: number) => T(`${steps} steps · ${targets} queue(s) or topic(s)`, `${steps} steps · ${targets} queue(s) ou topic(s)`),
        stepMessagesUnavailable: (path: string) =>
            T(
                `The messages of ${path} cannot be read: its namespace is not connected, or the queue or topic does not exist on Azure.`,
                `Les messages de ${path} ne peuvent pas être lus : son namespace n’est pas connecté, ou la queue ou le topic n’existe pas sur Azure.`,
            ),
        colSequence: T('Seq.', 'N°'),
        colEnqueued: T('Enqueued', 'Mis en file'),
        colDelivery: T('Deliveries', 'Livraisons'),
        colSource: T('Read from', 'Lu dans'),
        unknownStep: T('step not loaded', 'step non chargé'),
        notDataverseMessage: T('(not a Dataverse message)', '(pas un message Dataverse)'),
        bodyTitle: (format: string | undefined, size: string) => (format ? T(`Body · ${format} · ${size}`, `Contenu · ${format} · ${size}`) : T('Body', 'Contenu')),
        openBody: T('Open', 'Ouvrir'),
        sectionMessage: 'Message',
        sectionDataverse: T('Dataverse context', 'Contexte Dataverse'),
        sectionApplicationProperties: T('Application properties', 'Propriétés applicatives'),
        propSource: T('Read from', 'Lu dans'),
        propSequence: T('Sequence number', 'Numéro de séquence'),
        propMessageId: T('Message ID', 'ID du message'),
        propEnqueued: T('Enqueued', 'Mis en file'),
        propScheduled: T('Scheduled for', 'Planifié pour'),
        propExpires: T('Expires', 'Expire'),
        propDeliveryCount: T('Delivery count', 'Nombre de livraisons'),
        propContentType: T('Content type', 'Type de contenu'),
        propSubject: T('Subject (label)', 'Sujet (label)'),
        propCorrelation: T('Correlation ID', 'ID de corrélation'),
        propSession: T('Session ID', 'ID de session'),
        propTo: T('To', 'À'),
        propReplyTo: T('Reply to', 'Répondre à'),
        propStepId: T('Step ID', 'ID du step'),
        propRecord: T('Record ID', 'ID de la ligne'),
        propDepth: T('Depth', 'Profondeur'),
        propUser: T('User', 'Utilisateur'),
        propInitiatingUser: T('Initiating user', 'Utilisateur initiateur'),
        propOrganization: T('Organization', 'Organisation'),
        propOperationCorrelation: T('Operation correlation ID', 'ID de corrélation de l’opération'),
        propOperationCreated: T('Operation created on', 'Opération créée le'),
        // #endregion

        // #region Connections
        connectionsTitle: T('Azure connections', 'Connexions Azure'),
        connectionsSubtitle: T('The namespaces read by the tool. Azure is only read, never changed.', 'Les namespaces lus par l’outil. Azure est uniquement lu, jamais modifié.'),
        tabConnected: T('Connected', 'Connectés'),
        tabConnectionString: 'Connection string',
        tabMicrosoft: T('Microsoft account', 'Compte Microsoft'),
        colMethod: T('Method', 'Méthode'),
        colDetail: T('Detail', 'Détail'),
        methodLabel: (method: ConnectionMethod) => (method === 'connectionString' ? 'Connection string' : method === 'azureCli' ? 'Azure CLI' : T('Microsoft account', 'Compte Microsoft')),
        keyRemembered: T('Remembered in the ToolBox settings', 'Mémorisée dans les paramètres du ToolBox'),
        keySession: T('This session only', 'Cette session uniquement'),
        keyMissing: T('To enter again', 'À saisir de nouveau'),
        neededByDataverse: (hosts: string) => T(`Used by Dataverse and not connected: ${hosts}`, `Utilisés par Dataverse et non connectés : ${hosts}`),
        connectHost: (host: string) => T(`Paste the connection string of ${host}.`, `Collez la connection string de ${host}.`),
        connectionStringLabel: T('Connection string of the namespace', 'Connection string du namespace'),
        connectionStringHint: T(
            'Azure portal ▸ your namespace ▸ Shared access policies ▸ RootManageSharedAccessKey (or another policy with the Manage right). The tool only uses it to read.',
            'Portail Azure ▸ votre namespace ▸ Stratégies d’accès partagé ▸ RootManageSharedAccessKey (ou une autre stratégie avec le droit Manage). L’outil ne s’en sert que pour lire.',
        ),
        rememberKey: T('Remember it on this computer', 'La mémoriser sur ce poste'),
        rememberKeyHint: T(
            'The ToolBox settings are not encrypted: leave this unchecked to keep the key in memory for this session only.',
            'Les paramètres du ToolBox ne sont pas chiffrés : laissez décoché pour garder la clé en mémoire pour cette session uniquement.',
        ),
        testAndAdd: T('Test and add', 'Tester et ajouter'),
        signInMicrosoft: T('Sign in with a code', 'Se connecter avec un code'),
        useAzureCli: T('Use the Azure CLI', 'Utiliser Azure CLI'),
        microsoftHint: T(
            'No key needed: the Reader role on the namespace is enough. Tokens stay in memory and are never saved. The sign-in uses a code entered in your browser; the Azure CLI uses the account of « az login ».',
            'Aucune clé nécessaire : le rôle Reader sur le namespace suffit. Les jetons restent en mémoire et ne sont jamais enregistrés. La connexion utilise un code saisi dans votre navigateur ; Azure CLI utilise le compte de « az login ».',
        ),
        addSelected: T('Add the selected namespaces', 'Ajouter les namespaces cochés'),
        searchingNamespaces: T('Looking for your namespaces…', 'Recherche de vos namespaces…'),
        searchingIn: (subscription: string) => T(`Reading ${subscription}…`, `Lecture de ${subscription}…`),
        testingConnection: T('Testing the connection…', 'Test de la connexion…'),
        foundNamespaces: (count: number) => T(`${count} namespace(s) found. Tick those to add.`, `${count} namespace(s) trouvé(s). Cochez ceux à ajouter.`),
        noNamespaceFound: T('No namespace found with this account.', 'Aucun namespace trouvé avec ce compte.'),
        connectionAdded: (host: string) => T(`${host} was added. Click Load to read it.`, `${host} a été ajouté. Cliquez sur Charger pour le lire.`),
        connectionsAdded: (count: number) => T(`${count} namespace(s) added. Click Load to read them.`, `${count} namespace(s) ajouté(s). Cliquez sur Charger pour les lire.`),
        noConnection: T('No namespace yet: add one with a connection string or a Microsoft account.', 'Aucun namespace pour l’instant : ajoutez-en un avec une connection string ou un compte Microsoft.'),
        colSubscriptionAzure: T('Azure subscription', 'Abonnement Azure'),
        colResourceGroup: T('Resource group', 'Groupe de ressources'),
        colTier: T('Tier', 'Niveau'),
        colHost: 'Namespace',
        reloadHint: T('Connections changed: click Load to refresh.', 'Connexions modifiées : cliquez sur Charger pour actualiser.'),
        // #endregion

        // #region Options
        optionsSubtitle: T('Settings of ServiceBus Explorer', 'Paramètres de ServiceBus Explorer'),
        optionParallel: T('Parallel Azure requests', 'Requêtes Azure parallèles'),
        optionParallelHint: T('Used to read the subscriptions and filters. Lower it if Azure limits the requests.', 'Sert à lire les souscriptions et les filtres. Réduisez si Azure limite les requêtes.'),
        optionMaxMessages: T('Active messages read per queue', 'Messages actifs lus par file'),
        optionMaxMessagesHint: T(
            'Oldest first, for each queue or subscription (the dead-letter queue is not read). Peeking takes nothing: the messages stay where they are.',
            'Les plus anciens d’abord, pour chaque queue ou souscription (la dead-letter queue n’est pas lue). La lecture ne prend rien : les messages restent où ils sont.',
        ),
        optionTenant: T('Microsoft Entra tenant (optional)', 'Tenant Microsoft Entra (facultatif)'),
        optionTenantHint: T('Leave empty to use the tenant of your account.', 'Laissez vide pour utiliser le tenant de votre compte.'),
        optionClient: T('Application (client) ID (optional)', 'ID d’application (client) (facultatif)'),
        optionClientHint: T(
            'Leave empty for the public client of the Azure CLI. If your tenant blocks it, register a public client that allows the device code flow, with the Azure Service Management permission.',
            'Laissez vide pour le client public d’Azure CLI. Si votre tenant le bloque, enregistrez un client public qui autorise le flux device code, avec la permission Azure Service Management.',
        ),
        // #endregion

        // #region Status and export
        summary: (namespaces: number, endpoints: number, steps: number) => `${namespaces} namespace(s) · ${endpoints} endpoint(s) · ${steps} step(s)`,
        summaryErrors: (count: number) => T(` · ${count} namespace(s) in error`, ` · ${count} namespace(s) en erreur`),
        loadedAt: (time: string) => T(` · read at ${time}`, ` · lu à ${time}`),
        exportDoneTitle: T('Report exported', 'Rapport exporté'),
        exportDone: (path: string) => T(`The report was saved to ${path}.`, `Le rapport a été enregistré dans ${path}.`),
        loadFirst: T('Click Load first.', 'Cliquez d’abord sur Charger.'),
        sheetMatching: 'Matching',
        sheetSteps: 'Steps',
        sheetImages: 'Images',
        sheetEntities: T('Queues and topics', 'Queues et topics'),
        sheetSubscriptions: T('Subscriptions', 'Souscriptions'),
        sheetRules: T('Filters', 'Filtres'),
        colTopic: 'Topic',
        colScheduled: T('Scheduled', 'Planifiés'),
        colSize: T('Size (bytes)', 'Taille (octets)'),
        colEnabledSteps: T('Enabled steps', 'Steps actifs'),
        // #endregion

        // #region Help
        helpSubtitle: T('Explore Azure Service Bus and manage the Dataverse steps that send to it', 'Explorer Azure Service Bus et gérer les steps Dataverse qui lui envoient des messages'),
        helpText: T(
            '1. AZURE CONNECTIONS\n' +
                'Add your namespaces with one of the methods:\n' +
                '  - Connection string: needs a namespace-level key with the Manage right. It stays in memory for the session, or in the ToolBox settings if you tick Remember (not encrypted).\n' +
                '  - Microsoft account: sign in with a code in your browser, or use the Azure CLI. The Reader role on the namespace is enough, no key is needed.\n' +
                'Reading the messages needs a little more: the Listen right for a key (Manage includes it), or the « Azure Service Bus Data Receiver » role for a Microsoft account.\n' +
                'The first time, the ToolBox asks you to allow the network access of the tool to Azure: accept it.\n\n' +
                '2. LOAD\n' +
                'Nothing is read until you click Load. The tool reads the namespaces on Azure, then the Dataverse service endpoints, their steps and their images. ' +
                'Without any Azure connection the steps are still displayed: the namespaces used by Dataverse appear greyed out.\n\n' +
                '3. EXPLORER\n' +
                'The tree shows the queues, topics, subscriptions and rules with their message counters. Select an item to see the Dataverse steps that send to it, ' +
                'the subscriptions and filters, the properties and the messages. A subscription shows the steps of its topic, because they feed it.\n\n' +
                '4. MATCHING\n' +
                'Every endpoint and every Azure entity, with a status: Linked, No steps, Missing on Azure, Wrong type, Not connected, No endpoint.\n\n' +
                '5. STEPS\n' +
                'Edit opens the trigger (message, table, stage, mode, rank, filtering columns) and the images. Every change is reviewed in a summary before it is written. ' +
                'Steps can also be enabled and disabled in bulk. Managed steps that are not customizable are read-only.\n\n' +
                '6. MESSAGES\n' +
                'The Messages tab of a queue, topic or subscription, and the Messages button of the steps, peek the active messages waiting (the dead-letter queue is not read). ' +
                'Each message is linked to the step that sent it (the OwningExtension of its Dataverse context), whatever the format of the endpoint: JSON, XML or .NETBinary. ' +
                'A peek takes nothing: the messages are not locked, not removed, and their delivery count does not change.\n\n' +
                'The tool only reads Azure: it never changes a queue, a topic, a filter or a message. It only writes the steps and images in Dataverse.',
            '1. CONNEXIONS AZURE\n' +
                'Ajoutez vos namespaces avec l’une des méthodes :\n' +
                '  - Connection string : il faut une clé au niveau du namespace avec le droit Manage. Elle reste en mémoire pour la session, ou dans les paramètres du ToolBox si vous cochez Mémoriser (non chiffrée).\n' +
                '  - Compte Microsoft : connexion avec un code dans votre navigateur, ou Azure CLI. Le rôle Reader sur le namespace suffit, aucune clé n’est nécessaire.\n' +
                'Lire les messages demande un peu plus : le droit Listen pour une clé (Manage l’inclut), ou le rôle « Azure Service Bus Data Receiver » pour un compte Microsoft.\n' +
                'La première fois, le ToolBox demande d’autoriser l’accès réseau de l’outil vers Azure : acceptez-le.\n\n' +
                '2. CHARGER\n' +
                'Rien n’est lu tant que vous ne cliquez pas sur Charger. L’outil lit les namespaces sur Azure, puis les service endpoints Dataverse, leurs steps et leurs images. ' +
                'Sans connexion Azure, les steps restent affichés : les namespaces utilisés par Dataverse apparaissent grisés.\n\n' +
                '3. EXPLORATEUR\n' +
                'L’arbre montre les queues, topics, souscriptions et règles avec leurs compteurs de messages. Sélectionnez un élément pour voir les steps Dataverse qui lui envoient des messages, ' +
                'les souscriptions et filtres, les propriétés et les messages. Une souscription affiche les steps de son topic, puisque ce sont eux qui l’alimentent.\n\n' +
                '4. MATCHING\n' +
                'Chaque endpoint et chaque entité Azure, avec un statut : Lié, Sans step, Absent d’Azure, Mauvais type, Non connecté, Sans endpoint.\n\n' +
                '5. STEPS\n' +
                'Modifier ouvre le trigger (message, table, stage, mode, rang, colonnes de filtrage) et les images. Chaque changement est récapitulé avant d’être écrit. ' +
                'Les steps peuvent aussi être activés et désactivés en masse. Les steps managés non personnalisables sont en lecture seule.\n\n' +
                '6. MESSAGES\n' +
                'L’onglet Messages d’une queue, d’un topic ou d’une souscription, et le bouton Messages des steps, lisent les messages actifs en attente (la dead-letter queue n’est pas lue). ' +
                'Chaque message est rattaché au step qui l’a envoyé (l’OwningExtension de son contexte Dataverse), quel que soit le format de l’endpoint : JSON, XML ou .NETBinary. ' +
                'La lecture ne prend rien : les messages ne sont ni verrouillés ni retirés, et leur nombre de livraisons ne change pas.\n\n' +
                'L’outil ne fait que lire Azure : il ne modifie jamais une queue, un topic, un filtre ou un message. Il n’écrit que les steps et les images dans Dataverse.',
        ),
        // #endregion
    };
}

export type Strings = ReturnType<typeof build>;

const cache: Partial<Record<Language, Strings>> = {};

export function getStrings(language: Language): Strings {
    return (cache[language] ??= build(language === 'fr'));
}
