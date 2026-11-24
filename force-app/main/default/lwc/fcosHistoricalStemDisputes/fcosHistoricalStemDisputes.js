import { api, LightningElement, wire } from 'lwc';
import { gql, graphql } from 'lightning/graphql';

const DISPUTES = gql`
    query HistoricalStemDisputes($stemId: ID!, $after: String) {
        uiapi {
            query {
                Dispute__c(
                    first: 50
                    after: $after
                    where: { STEM__c: { eq: $stemId } }
                    orderBy: { Id: { order: ASC } }
                ) {
                    edges { node { Id Name { value } STEM__c { value } } }
                    pageInfo { hasNextPage endCursor }
                }
            }
        }
    }
`;

export default class FcosHistoricalStemDisputes extends LightningElement {
    stemId;
    cursor = null;
    rows = [];
    loading = true;
    loadError = false;
    nextCursor;

    @api
    get recordId() {
        return this.stemId;
    }

    set recordId(value) {
        if (value === this.stemId) return;
        this.stemId = value;
        this.loadPage(null);
    }

    get query() {
        return this.stemId ? DISPUTES : undefined;
    }

    get variables() {
        return { stemId: this.stemId, after: this.cursor };
    }

    get hasRows() {
        return this.rows.length > 0;
    }

    get hasNextPage() {
        return Boolean(this.nextCursor);
    }

    get canReturnToFirstPage() {
        return Boolean(this.cursor);
    }

    @wire(graphql, { query: '$query', variables: '$variables' })
    receiveDisputes({ data, errors }) {
        if (!data && !errors?.length) return;
        const result = data?.uiapi?.query?.Dispute__c;
        const owner = this.stemId?.slice(0, 15);
        const matching = owner && result?.edges?.every(({ node }) =>
            node?.STEM__c?.value?.slice(0, 15) === owner
            && typeof node?.Id === 'string' && typeof node?.Name?.value === 'string');
        this.loading = false;
        this.loadError = Boolean(errors?.length || !matching);
        this.rows = this.loadError ? [] : result.edges.map(({ node }) => ({ id: node.Id, name: node.Name.value }));
        this.nextCursor = !this.loadError && result.pageInfo?.hasNextPage ? result.pageInfo.endCursor : undefined;
    }

    loadPage(cursor) {
        this.cursor = cursor;
        this.loading = true;
        this.loadError = false;
        this.rows = [];
        this.nextCursor = undefined;
    }

    goToFirstPage() {
        this.loadPage(null);
    }

    goToNextPage() {
        if (this.nextCursor) this.loadPage(this.nextCursor);
    }
}
