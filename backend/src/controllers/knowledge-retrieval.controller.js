import {
    searchKnowledgeBase
} from '../services/knowledge-retrieval.service.js';


export const searchKnowledgeBaseController = async (

    req,

    res,

    next

) => {

    try {

        const result = await searchKnowledgeBase({

            // Derived from verified organization middleware.
            organizationId: req.organization.id,

            knowledgeBaseId:
                req.params.knowledgeBaseId,

            query:
                req.body?.query,

            topK:
                req.body?.top_k ?? 8,

            scoreThreshold:
                req.body?.score_threshold ?? 0.15

        });


        return res.status(200).json({

            success: true,

            ...result

        });


    } catch (error) {

        return next(error);

    }

};